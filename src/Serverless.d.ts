declare namespace Serverless {
	interface Instance {

		config: {
			servicePath: string
		}

		service: {

			service: string

			provider: {
				name: string
				runtime?: string
			}

			package: Serverless.Package

			custom: {
				"normal-esbuild"?: {
					node_module?: boolean
				}
			}
		}

		classes: {
			Error: (message: any)=>void
		}
	}

	interface Options {
		function?: string
		watch?: boolean
		extraServicePath?: string
	}

	interface Extra {
		log: {
			error: (message: string) => void
			success: (message: string) => void
			info: (message: string) => void
			warning: (message: string) => void
			debug: (message: string) => void
			verbose: (message: string) => void
		},
		progress: {
			create: (option: progressCreateOption) => progressCreateReturn
		}
	}

	interface progressCreateOption {
		message: string
		name?: string
	}

	interface progressCreateReturn {
		remove: () => void
		update: (message: string) => void
	}

	interface Function {
		handler: string
		package: Serverless.Package
		runtime?: string
	}

	interface Package {
		include: string[]
		exclude: string[]
		patterns: string[]
		artifact?: string
		individually?: boolean
	}
}
