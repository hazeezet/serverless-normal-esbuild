'use strict';

import fse from 'fs-extra';
import fs from "fs";
import copyNodeModules from '@bitc/copy-node-modules';
import chokidar from "chokidar";
import archiver from 'archiver';
import path from 'path';
import shelljs from "shelljs"
import { relative } from 'path';
import { assocPath } from 'ramda';

const { readJSONSync, pathExistsSync } = fse

const SERVERLESS_FOLDER = '.serverless';

const DEFAULT_CONFIG: Serverless.Instance["service"]["custom"]["normal-esbuild"] = {
	/** package node_module by default */
	node_modules: true
}

class Normal_Build {

	private SERVERLESS: Serverless.Instance;
	private PROGRESS: Serverless.progressCreateReturn;
	private LOG: Serverless.Extra["log"];
	private NO_ERROR: boolean;
	private WATCHING_FILES: boolean;
	private BUILD_FOLDER: string;
	private FILES_TO_WATCH: [];
	private CONFIG: Serverless.Instance["service"]["custom"]["normal-esbuild"]
	hooks: { [key: string]: Function }
	PACKAGES: {};

	constructor(serverless: Serverless.Instance, _option: Serverless.Options, { log, progress }: Serverless.Extra) {
		this.LOG = log;

		this.PROGRESS = progress.create({
			message: 'Compiling with normal esbuild'
		});

		this.NO_ERROR = true;
		this.WATCHING_FILES = false;
		this.SERVERLESS = serverless;

		this.hooks = {

			initialize: () => this.init(),

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

	init() {

		this.CONFIG = this.SERVERLESS.service.custom && this.SERVERLESS.service.custom['normal-esbuild'] !== undefined ? this.SERVERLESS.service.custom['normal-esbuild'] : DEFAULT_CONFIG;

		this.PROGRESS.update("Getting information from tsconfig file");

		const tsconfig_path = relative(this.SERVERLESS.config.servicePath, path.join("tsconfig.json"));
		const package_path = relative(this.SERVERLESS.config.servicePath, path.join("package.json"));

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
		this.PACKAGES = packages && packages.dependencies ? packages.dependencies : {};
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

		this.PROGRESS.update("packaging dependencies. . .");

		return new Promise((resolve, reject) => {
			const srcDir = process.cwd();
			copyNodeModules(srcDir, this.BUILD_FOLDER, { devDependencies: false }, (err, _results) => {
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

	}
}

export default Normal_Build;
