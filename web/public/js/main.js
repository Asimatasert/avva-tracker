// AVVA Tracker - Main JS

document.addEventListener('DOMContentLoaded', () => {
  // Lazy load images
  const images = document.querySelectorAll('img[loading="lazy"]');
  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.src = img.dataset.src || img.src;
          imageObserver.unobserve(img);
        }
      });
    });
    images.forEach(img => imageObserver.observe(img));
  }

  // Auto-submit form on select change
  const selects = document.querySelectorAll('.filter-select');
  selects.forEach(select => {
    select.addEventListener('change', () => {
      // Optional: auto-submit
      // select.closest('form').submit();
    });
  });
});
