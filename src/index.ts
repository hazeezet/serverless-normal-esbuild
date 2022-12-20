'use strict';

import fse from 'fs-extra';
import fs from "fs";
import url from "url";
import copyNodeModules from '@bitc/copy-node-modules';
import chokidar from "chokidar";
import archiver from 'archiver';
import path from 'path';
import shelljs from "shelljs"
import { relative } from 'path';
import { assocPath } from 'ramda';

type PackageJson = {
	name: string;
	version: string;
	dependencies: { [dependency: string]: string };
	scripts: { [scriptName: string]: string };
};

const { readJSONSync, pathExistsSync, writeJSONSync, copyFileSync } = fse

const SERVERLESS_FOLDER = '.serverless';

const DEFAULT_NORMAL_ESBUILD_CONFIG: Serverless.Instance["service"]["custom"]["normal-esbuild"] = {
	/** package node_module by default */
	node_modules: true,
	/** package manager to use */
	packager: "npm"
}

const DEFAULT_ETSC_CONFIG = {
	/** don't compress imports into single file */
	bundle: false,
	/** external dependencies */
	external: []
}

class Normal_Build {

	private SERVERLESS: Serverless.Instance;
	private PROGRESS: Serverless.progressCreateReturn;
	private LOG: Serverless.Extra["log"];
	private NO_ERROR: boolean;
	private WATCHING_FILES: boolean;
	private BUILD_FOLDER: string;
	private FILES_TO_WATCH: [];
	private ETSC_CONFIG = DEFAULT_ETSC_CONFIG;
	private CONFIG: Serverless.Instance["service"]["custom"]["normal-esbuild"]
	hooks: { [key: string]: Function }
	PACKAGES: PackageJson;

	constructor(serverless: Serverless.Instance, _option: Serverless.Options, { log, progress }: Serverless.Extra) {
		this.LOG = log;

		this.PROGRESS = progress.create({
			message: 'Compiling with normal esbuild'
		});
		
		this.NO_ERROR = true;
		this.WATCHING_FILES = false;
		this.SERVERLESS = serverless;

		this.hooks = {

			initialize: async () => await this.init(),

			'before:offline:start': async () => {
				await this.checkTypes()
				await this.compile()
				await this.packPackages()
				await this.offline()
				await this.watchAll()
			},

			'before:run:run': async () => {
				await this.checkTypes()
				await this.compile()
				await this.packPackages()
			},

			'before:package:createDeploymentArtifacts': async () => {
				await this.checkTypes()
				await this.compile()
				await this.packPackages()
				await this.zip();
			},

			'after:package:createDeploymentArtifacts': async () => {
				await this.cleanup()
			},

			'before:deploy:function:packageFunction': async () => {
				this.SERVERLESS.classes.Error("Packaging of function is not available, You are welcome to contribute and support this")
			},

			'before:invoke:local:invoke': async () => {
				this.SERVERLESS.classes.Error("This is not available, You are welcome to contribute and support this")
			},
		};
	}

	async init() {

		this.CONFIG = this.SERVERLESS.service.custom && this.SERVERLESS.service.custom['normal-esbuild'] !== undefined ? this.SERVERLESS.service.custom['normal-esbuild'] : DEFAULT_NORMAL_ESBUILD_CONFIG;

		this.PROGRESS.update("Getting information from tsconfig file");

		const tsconfig_path = relative(this.SERVERLESS.config.servicePath, path.join("tsconfig.json"));
		const package_path = relative(this.SERVERLESS.config.servicePath, path.join("package.json"));


		const esconfig_path = relative(this.SERVERLESS.config.servicePath, path.join("etsc.config.js"));

		if (pathExistsSync(esconfig_path)) {
			try {
				const conf = path.resolve(process.cwd(), "etsc.config.js")
				const configPathUrl = path.isAbsolute(conf) ? url.pathToFileURL(conf).toString() : conf;

                const { default: esconfig } = await import(configPathUrl);
                this.ETSC_CONFIG.bundle = esconfig && esconfig.esbuild ? esconfig.esbuild.bundle : false;
                this.ETSC_CONFIG.external = esconfig && esconfig.esbuild ? esconfig.esbuild.external : [];
            }
            catch (e) {
                this.LOG.error("etsc config file has some errors");
                throw new this.SERVERLESS.classes.Error(e);
            }
		}
		else {
			this.LOG.warning("Using default config of etsc");
		}

		if (!pathExistsSync(package_path)) {
			this.PROGRESS.remove();
			throw new this.SERVERLESS.classes.Error("package.json file could not be found in your root directory");
		}

		if (!pathExistsSync(tsconfig_path)) {
			this.PROGRESS.remove();
			throw new this.SERVERLESS.classes.Error("tsconfig file could not be found in your root directory");
		}


		const tsconfig = readJSONSync(tsconfig_path);
		const packages = readJSONSync(package_path);
		this.PACKAGES = packages && packages.dependencies ? packages : {};
		this.BUILD_FOLDER = tsconfig.compilerOptions.outDir ?? "dist";
		this.FILES_TO_WATCH = tsconfig.include ?? relative(this.SERVERLESS.config.servicePath, path.join("src/**/*.ts"));
	}

	/** Check for errors in typescript files */
	async checkTypes() {
		this.PROGRESS.update("Checking for errors");
		return new Promise((resolve, reject) => {
			shelljs.exec("npx tsc --noEmit", {}, (code, stdout, stderr) => {
				if (code) {
					if (this.WATCHING_FILES) {
						this.LOG.error("Unable to compile, one or more error occured");
						this.LOG.verbose(stderr);
						this.PROGRESS.update("Waiting for changes");
						this.NO_ERROR = false;
						return resolve(true)
					}
					this.PROGRESS.remove();
					throw new this.SERVERLESS.classes.Error(stderr);
				}
				this.NO_ERROR = true;
				resolve(true);
			})
		});

	}

	/** Compile files using esbuild */
	async compile() {

		if (!this.NO_ERROR) return;

		this.PROGRESS.update("Bundling. . .");
		return new Promise((resolve, reject) => {
			shelljs.exec("npx etsc", {}, (code, stdout, stderr) => {
				if (code) {
					if (this.WATCHING_FILES) {
						this.LOG.error("Unable to compile, one or more errors occured");
						this.PROGRESS.update("Waiting for changes");
						this.NO_ERROR = false;
						return resolve(true)
					}
					this.PROGRESS.remove();
					throw new this.SERVERLESS.classes.Error(stderr);
				}

				resolve(true);
			})
		});

	}

	async watchAll() {

		const patterns = [...(this.FILES_TO_WATCH || [])]

		return new Promise(async (resolve, reject) => {
			if (patterns.length > 0) {
				const watcher = chokidar.watch(patterns, {
					persistent: true
				});

				watcher.on("change", async () => {
					await this.checkTypes();
					await this.compile();
					if (this.NO_ERROR) {
						this.LOG.success("Compiled successful")
						this.PROGRESS.remove()
					}
				})

				this.WATCHING_FILES = true;
				return resolve(true)
			}
			this.LOG.error("Files are empty, unable to watch any files")
		});

	}

	/** Create an artifact of all the files */
	async zip() {

		if (!this.NO_ERROR) return;

		this.PROGRESS.update("Creating artifact . . .");

		const artifact_path = relative(this.SERVERLESS.config.servicePath, path.join(SERVERLESS_FOLDER, `${this.SERVERLESS.service.service}.zip`));
		const newServerless = assocPath(
			['service', 'package', 'artifact'],
			artifact_path,
			this.SERVERLESS
		);

		this.SERVERLESS.service.package = newServerless.service.package;

		const archive = archiver('zip', { zlib: { level: 9 } });
		const stream = fs.createWriteStream(artifact_path);

		return new Promise((resolve, reject) => {
			archive
				.directory(this.BUILD_FOLDER, false)
				.on('error', err => {
					this.PROGRESS.remove();
					throw new this.SERVERLESS.classes.Error(err);
				})
				.pipe(stream)

			stream.on('close', () => resolve(true));
			archive.finalize();
		});
	};

	/** Clean all progress */
	async cleanup() {

		this.PROGRESS.remove();

		this.LOG.success("All done")
	}

	/** Set offline directory for serverless offline plugin */
	async offline() {

		if (!this.NO_ERROR) return;

		this.PROGRESS.update("Setting offline directory. . .");
		const newServerless = assocPath(
			['service', 'custom', 'serverless-offline', 'location'],
			relative(this.SERVERLESS.config.servicePath, path.join(this.BUILD_FOLDER)),
			this.SERVERLESS
		);

		this.SERVERLESS.service.custom = newServerless.service.custom;
		this.PROGRESS.remove();
	}

	/** Package dev dependencies */
	async packPackages() {

		if (!this.NO_ERROR) return;

		if (this.CONFIG?.node_modules === false) return;

		if (this.ETSC_CONFIG.bundle && this.ETSC_CONFIG.external.length == 0) return;

		this.PROGRESS.update("packaging dependencies. . .");

		return new Promise((resolve, reject) => {
			let package_path: string;

            if ((this.ETSC_CONFIG.bundle) && (this.ETSC_CONFIG.external.length > 0)) {
                handleExternal(this.PACKAGES, this.ETSC_CONFIG.external, this.BUILD_FOLDER, this.CONFIG.packager);
                package_path = this.BUILD_FOLDER;
            }
			else{
				copyPackageJson(this.BUILD_FOLDER);

				//TODO:
				// copyPackageLockFile(this.BUILD_FOLDER, this.CONFIG.packager);
			}

			const srcDir = process.cwd();

            copyNodeModules(srcDir, this.BUILD_FOLDER, { devDependencies: false, packagePath: package_path }, (err, _results) => {
                if (err) {
					if (this.WATCHING_FILES) {
						this.LOG.error("An error occured during dependency packaging");
						this.LOG.verbose(err);
						this.PROGRESS.update("Waiting for changes");
						this.NO_ERROR = false;
						return resolve(true)
					}
					this.PROGRESS.remove();
					throw new this.SERVERLESS.classes.Error(err);
				}
				this.LOG.success("Compiled successful")
				return resolve(true);
			});
		});

		/** Filter the package.json such that it will only include the external dependencies that is defined
		 * and then create it in the build folder
		 */
		function handleExternal(packages: PackageJson, external: string[], dest: string, packager: string) {
			let new_dependencies = {};
			for (const dependency of external) {
				if (dependency in packages.dependencies) {
					new_dependencies[dependency] = packages.dependencies[dependency];
				}
			}
			// Update the dependencies in the package.json file
			const updatedPackageJson = Object.assign(packages, { dependencies: new_dependencies });
			writeJSONSync(path.join(dest,"package.json"), updatedPackageJson, { spaces: 2 });
			
			//TODO:
			// copyPackageLockFile(dest,packager)
		}

		function copyPackageJson(dest: string){
			const src = path.resolve(process.cwd(), "package.json")
			const srcUrl = path.isAbsolute(src) ? url.pathToFileURL(src).toString() : src;
			copyFileSync(srcUrl, path.join(dest,"package.json"))
		}

		//TODO:
		// function copyPackageLockFile(dest: string, packager: string){
		// 	let packager_file_path: string;
		// 	let packager_file_name: string;

		// 	if(packager == "npm"){
		// 		packager_file_name = "package-lock.json"
		// 		packager_file_path = path.resolve(process.cwd(), packager_file_name)
		// 	}

		// 	if(packager == "pnpm"){
		// 		packager_file_name = "pnpm-lock.yaml"
		// 		packager_file_path = path.resolve(process.cwd(), packager_file_name)
		// 	}
			
		// 	if(packager == "yarn"){
		// 		packager_file_name = "yarn.lock"
		// 		packager_file_path = path.resolve(process.cwd(), packager_file_name)
		// 	}

		// 	const srcUrl = path.isAbsolute(packager_file_path) ? url.pathToFileURL(packager_file_path).toString() : packager_file_path;
		// 	const dest_path = path.join(path.resolve(process.cwd(), dest), packager_file_name);
		// 	const dest_url = path.isAbsolute(dest_path) ? url.pathToFileURL(dest_path).toString() : dest_path;
            
		// 	copyFileSync(srcUrl, dest_url);

		// 	shelljs.cd(dest_path);
		// 	shelljs.exec(packager.toLocaleLowerCase() + " prune");
		// 	shelljs.cd();

		// }
	}
}

export default Normal_Build;
