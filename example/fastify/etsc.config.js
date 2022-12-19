const fs = require('fs');
const path = require('path');

module.exports = {
	// Supports all esbuild.build options
	esbuild: {
		minify: true,
		target: "es2022",
	},
	// Prebuild hook
	prebuild: async () => {
		console.log("I can do anything before build");
	},
	// Postbuild hook
	postbuild: async () => {
		console.log("Am doing something after build");
		const cpy = (await import("cpy")).default;
		await cpy(
			[
				"package.json",
				"package-lock.json",
				"!src/**/*.{tsx,ts,js,jsx}", // Ignore already built files
			],
			"dist"
		);
	},
};
