import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement scrollIntoView, but Radix UI's Select (and other
// popover-based components) call it internally. Polyfill as a no-op.
if (typeof window !== "undefined" && !window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}
