// Stub for the 'canvas' npm package — konva's node entry imports it but
// we only use the browser build. This file is aliased via webpack.
module.exports = {};
module.exports.default = {};
module.exports.createCanvas = function() {
  return { getContext: function() { return null; }, width: 0, height: 0 };
};
module.exports.DOMMatrix = function() {};
