import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cuanki POS",
    short_name: "Cuanki POS",
    description: "Kasir Cuanki dan rekonsiliasi shift",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#161010",
    theme_color: "#161010",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
