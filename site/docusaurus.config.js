// @ts-check
import { themes as prismThemes } from "prism-react-renderer";

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "TMA via ML",
  tagline: "Can a neural network learn target motion analysis from bearings alone?",
  url: "https://debrief.github.io",
  baseUrl: process.env.SITE_BASE_URL ?? "/Gitma/",
  organizationName: "debrief",
  projectName: "Gitma",
  trailingSlash: false,
  onBrokenLinks: "throw",
  onBrokenAnchors: "throw",
  markdown: { format: "detect", mermaid: true, hooks: { onBrokenMarkdownLinks: "throw" } },
  themes: ["@docusaurus/theme-mermaid"],
  i18n: { defaultLocale: "en", locales: ["en"] },
  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: "./sidebars.js",
          editUrl: "https://github.com/debrief/Gitma/edit/main/site/",
        },
        blog: {
          showReadingTime: true,
          onInlineAuthors: "ignore",
          onUntruncatedBlogPosts: "ignore",
        },
        theme: { customCss: "./src/css/custom.css" },
      }),
    ],
  ],
  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      navbar: {
        title: "TMA via ML",
        items: [
          { to: "/docs/glossary", label: "Glossary", position: "left" },
          { to: "/docs/data-dictionary", label: "Data dictionary", position: "left" },
          { to: "/docs/algorithms/generator", label: "Algorithms", position: "left" },
          { to: "/docs/results/iteration-1", label: "Results", position: "left" },
          { to: "/blog", label: "Blog", position: "left" },
          { href: "https://github.com/debrief/Gitma", label: "GitHub", position: "right" },
        ],
      },
      footer: {
        style: "dark",
        copyright: "Mock data only; nothing above OFFICIAL. Apache-2.0.",
      },
      prism: { theme: prismThemes.github, darkTheme: prismThemes.dracula },
    }),
};

export default config;
