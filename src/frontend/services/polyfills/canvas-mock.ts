const canvasMock = {
  createCanvasElement: () => ({
    getContext: () => null,
    width: 0,
    height: 0,
  }),
  DOMMatrix: class DOMMatrix {},
};

export default canvasMock;
