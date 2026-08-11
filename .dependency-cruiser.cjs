module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "model-is-foundational",
      severity: "error",
      from: { path: "^packages/model/src" },
      to: { path: "^packages/(?!model/)" },
    },
    {
      name: "kernel-only-depends-on-model",
      severity: "error",
      from: { path: "^packages/kernel/src" },
      to: { path: "^packages/(?!model/|kernel/)" },
    },
    {
      name: "geometry-only-depends-on-model",
      severity: "error",
      from: { path: "^packages/geometry/src" },
      to: { path: "^packages/(?!model/|geometry/)" },
    },
    {
      name: "headless-does-not-import-platforms",
      severity: "error",
      from: { path: "^packages/(model|kernel|geometry)/src" },
      to: { path: "^(react|react-dom|effect|xstate|motion)(/|$)" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"] },
    reporterOptions: { dot: { collapsePattern: "node_modules/[^/]+" } },
  },
};
