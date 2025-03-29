import { sveltekit } from "@sveltejs/kit/vite";
import Icons from "unplugin-icons/vite";
import { promises } from "fs";
import { defineConfig } from "vitest/config";

// Log env vars for debugging
console.log("Vite Config - ACCOUNT_SERVICE_URL:", process.env.ACCOUNT_SERVICE_URL);
console.log("Vite Config - Defining VITE_ACCOUNT_SERVICE_URL:", process.env.ACCOUNT_SERVICE_URL);

// used to load fonts server side for thumbnail generation
function loadTTFAsArrayBuffer() {
	return {
		name: "load-ttf-as-array-buffer",
		async transform(_src, id) {
			if (id.endsWith(".ttf")) {
				return `export default new Uint8Array([
            ${new Uint8Array(await promises.readFile(id))}
          ]).buffer`;
			}
		},
	};
}

export default defineConfig({
	plugins: [
		sveltekit(),
		Icons({
			compiler: "svelte",
		}),
		loadTTFAsArrayBuffer(),
	],
	optimizeDeps: {
		include: ["uuid", "@huggingface/transformers", "sharp", "@gradio/client"],
	},
	server: {
		open: "/",
	},
	test: {
		setupFiles: ["./scripts/setupTest.ts"],
		deps: { inline: ["@sveltejs/kit"] },
		globals: true,
		testTimeout: 10000,
	},
	define: {
		"import.meta.env.VITE_REDIRECT_URI": JSON.stringify(
			process.env.OPENID_CONFIG ? JSON.parse(process.env.OPENID_CONFIG).REDIRECT_URI : undefined
		),
		"import.meta.env.VITE_ACCOUNT_SERVICE_URL": JSON.stringify(
			process.env.VITE_ACCOUNT_SERVICE_URL
		),
		"import.meta.env.VITE_KEYCLOAK_BASE_URL": JSON.stringify(process.env.VITE_KEYCLOAK_BASE_URL),
	},
});
