import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cuanki Cep Bewok Express POS",
    short_name: "Cuanki POS",
    description: "Kasir Cuanki Cep Bewok Express dan rekonsiliasi shift",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#161010",
    theme_color: "#161010",
    icons: [
      { src: "/cuanki-icon-192.png?v=4", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/cuanki-icon-192.png?v=4", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/cuanki-icon-512.png?v=4", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/cuanki-icon-512.png?v=4", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
