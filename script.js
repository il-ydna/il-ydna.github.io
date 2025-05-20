window.addEventListener("DOMContentLoaded", () => {
  const groups = document.querySelectorAll("#logo g");

  groups.forEach((group, index) => {
    const line = group.querySelector("line");
    const transformAttr = line.getAttribute("transform");

    if (transformAttr && transformAttr.startsWith("matrix(")) {
      const matrixValues = transformAttr
        .slice(7, -1)
        .split(" ")
        .map(parseFloat);

      const [a, b] = matrixValues;
      const angle = Math.atan2(b, a);

      const distance = 1000;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;

      group.style.transform = `translate(${dx}px, ${dy}px)`;
      group.style.transition = "transform 1s cubic-bezier(0.2, 0.8, 0.2, 1)";
      group.style.transitionDelay = "0ms";
    }
  });

  // Force reflow to ensure starting transforms are applied
  document.querySelector("#logo").getBoundingClientRect();

  setTimeout(() => {
    groups.forEach((group, index) => {
      const pairIndex = Math.floor(index / 2);
      const delay = pairIndex * 300;

      group.style.transitionDelay = `${delay}ms`;
      group.style.transform = "translate(0, 0)";
    });
  }, 0);
});
