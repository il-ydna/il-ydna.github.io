const postForm = document.getElementById("postForm");
const postsSection = document.getElementById("posts");

// Load posts from localStorage on page load
window.addEventListener("DOMContentLoaded", loadPosts);

postForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const titleInput = postForm.querySelector('input[name="title"]');
  const contentInput = postForm.querySelector('textarea[name="content"]');

  // Remove existing error message
  removeValidationMessage();

  // Custom validation
  if (!titleInput.value.trim() || !contentInput.value.trim()) {
    showValidationMessage("Put both title and content.");
    return;
  }

  const formData = new FormData(postForm);
  const file = formData.get("image");

  let imageBase64 = null;
  if (file && file.size > 0) {
    imageBase64 = await toBase64(file);
  }

  const newPost = {
    title: formData.get("title"),
    content: formData.get("content"),
    image: imageBase64,
    timestamp: Date.now(),
  };

  const posts = JSON.parse(localStorage.getItem("posts") || "[]");
  posts.unshift(newPost);
  localStorage.setItem("posts", JSON.stringify(posts));

  postForm.reset();
  loadPosts();
});

// Convert image file to base64 string
function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Load posts from localStorage and render them
function loadPosts() {
  const posts = JSON.parse(localStorage.getItem("posts") || "[]");
  postsSection.innerHTML = posts
    .map(
      (post) => `
      <article class="post">
        <h3>${post.title}</h3>
        <p>${post.content.replace(/\n/g, "<br>")}</p>
        ${post.image ? `<img src="${post.image}" alt="Post Image">` : ""}
        <small>${new Date(post.timestamp).toLocaleString()}</small>
      </article>
    `
    )
    .join("");
}

// Show a custom validation error above the form
function showValidationMessage(message) {
  const errorDiv = document.createElement("div");
  errorDiv.id = "form-error";
  errorDiv.textContent = message;
  errorDiv.style.color = "salmon";
  errorDiv.style.marginBottom = "1rem";
  errorDiv.style.textAlign = "center";
  errorDiv.style.fontFamily = "Times New Roman";
  postForm.append(errorDiv);
}

// Remove any previous validation error message
function removeValidationMessage() {
  const existing = document.getElementById("form-error");
  if (existing) existing.remove();
}
