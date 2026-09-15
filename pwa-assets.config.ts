import {
  defineConfig,
  minimal2023Preset as preset,
} from "@vite-pwa/assets-generator/config";

export default defineConfig({
  headLinkOptions: {
    preset: "2023",
  },
  preset: {
    ...preset,
    // resizeOptions replaces the preset's wholesale, so keep its fit: "contain"
    maskable: {
      ...preset.maskable,
      resizeOptions: { fit: "contain", background: "#ffffff" },
    },
    apple: {
      ...preset.apple,
      resizeOptions: { fit: "contain", background: "#ffffff" },
    },
  },
  images: ["public/logo.svg"],
});
