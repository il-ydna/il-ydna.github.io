const originalBg = document.querySelector(".original-bg");
const newBg = document.querySelector(".new-bg");
const scrollMax = 900;
const fadeInThreshold = 500; // px at which newBg starts fading in
let currentProgress = 0;
let fadeInProgress = 0;

function animateBackground() {
  const scroll = window.scrollY;
  const clampedScroll = Math.min(scroll, scrollMax);
  const targetProgress = clampedScroll / scrollMax;

  // Smooth interpolation for original background
  currentProgress += (targetProgress - currentProgress) * 0.1;
  originalBg.style.transform = `translateX(${currentProgress * 100}vw)`;
  originalBg.style.opacity = `${1 - currentProgress}`;

  // Fade in new background after threshold is reached
  if (scroll > fadeInThreshold) {
    fadeInProgress += (1 - fadeInProgress) * 0.4; // slower fade
  } else {
    fadeInProgress += (0 - fadeInProgress) * 0.6; // fade back out if needed
  }

  newBg.style.opacity = fadeInProgress;

  requestAnimationFrame(animateBackground);
}

requestAnimationFrame(animateBackground);
