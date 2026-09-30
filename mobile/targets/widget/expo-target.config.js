/** Lock-screen and home-screen widget: next game countdown + emergency card. */
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "AthleteWidget",
  deploymentTarget: "17.0",
  colors: { $widgetBackground: "#0b0e12", $accent: "#bff63f" },
  entitlements: {
    "com.apple.security.application-groups": config.ios.entitlements["com.apple.security.application-groups"],
  },
});
