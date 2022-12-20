
module.exports = {
	// Supports all esbuild.build options
	esbuild: {
		minify: true, // compress if you wish
		bundle: true, // Bundle your all imports into single file to reduce file size
		target: "es2022",
		external: ["fastify", "fastify-plugin"] // all this module are require by most folders so am adding it as external
	},
	// Prebuild hook
	prebuild: async () => {
		console.log("I can do anything before build");
	},
	// Postbuild hook
	postbuild: async () => {
		console.log("Am doing something after build");
	},
};
