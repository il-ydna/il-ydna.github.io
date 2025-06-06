const postForm = document.getElementById("postForm");
const postsSection = document.getElementById("posts");

// Load posts from localStorage on page load
window.addEventListener("DOMContentLoaded", loadPosts);

postForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const titleInput = postForm.querySelector('input[name="title"]');
  const contentInput = postForm.querySelector('textarea[name="content"]');
  const tagInput = postForm.querySelector('input[name="tag"]');

  // Remove existing error message
  removeValidationMessage();

  // Custom validation
  if (!titleInput.value.trim()) {
    showValidationMessage("Give a title.");
    return;
  }

  const formData = new FormData(postForm);
  const file = formData.get("image");

  let imageBase64 = null;
  if (file && file.size > 0) {
    imageBase64 = await toBase64(file);
  } else {
    imageBase64 = ""; // send empty string instead of null
  }

  const newPost = {
    title: formData.get("title"),
    content: formData.get("content"),
    image: imageBase64,
    tag: formData.get("tag") || "general",
    timestamp: Date.now(),
  };

  try {
    const response = await fetch(
      "https://6bm2adpxck.execute-api.us-east-2.amazonaws.com/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newPost),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      showValidationMessage(errorData.error || "Failed to submit post");
      return;
    }

    postForm.reset();
    loadPosts(); // reload posts from Lambda
  } catch (error) {
    showValidationMessage("Network error. Try again.");
  }
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

function getTagColor(tag) {
  const option = document.querySelector(
    `.dropdown-option[data-value="${tag}"]`
  );
  return option?.dataset.color || "#ccc"; // fallback color
}

function loadPosts() {
  fetch("https://6bm2adpxck.execute-api.us-east-2.amazonaws.com/")
    .then((res) => res.json())
    .then((posts) => {
      postsSection.innerHTML = posts;
      postsSection.innerHTML = posts
        .slice()
        .reverse()
        .map((post) => {
          const tagLabel = post.tag.charAt(0).toUpperCase() + post.tag.slice(1);
          const color = getTagColor(post.tag);

          return `
            <article class="post" data-id="${post.id}">
              <div
                class="tag-pill"
                style="--pill-color: ${color};"
                title="${tagLabel}"
              >
                <span class="pill-label">${tagLabel}</span>
              </div>
              <h3>${post.title}</h3>
              <p>${(post.content || "").replace(/\n/g, "<br>")}</p>
              ${post.image ? `<img src="${post.image}" alt="Post Image">` : ""}
              <div class="post-footer">
                <small>${new Date(post.timestamp).toLocaleString()}</small>
                <button onclick="deletePost('${post.id}')">Delete</button>
              </div>
            </article>
          `;
        })
        .join("");

      // Fade-in cascade animation
      requestAnimationFrame(() => {
        document.querySelectorAll(".post").forEach((el, i) => {
          setTimeout(() => el.classList.add("show"), i * 80);
        });
      });
    })
    .catch(() => {
      postsSection.innerHTML =
        "<p style='color:red; text-align:center;'>Failed to load posts.</p>";
    });
}

async function deletePost(id) {
  if (!confirm("Delete this post?")) return;

  try {
    const response = await fetch(
      `https://6bm2adpxck.execute-api.us-east-2.amazonaws.com/?id=${encodeURIComponent(
        id
      )}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      }
    );

    if (!response.ok) throw new Error("Delete failed");

    loadPosts(); // Refresh posts list
  } catch (err) {
    alert("Failed to delete post.");
    console.error(err);
  }
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

const dropdown = document.getElementById("tagDropdown");
const selected = dropdown.querySelector(".selected-option");
const options = dropdown.querySelector(".dropdown-options");
const hiddenInput = document.getElementById("tagInput");

selected.addEventListener("click", () => {
  options.style.display = options.style.display === "block" ? "none" : "block";
});

dropdown.querySelectorAll(".dropdown-option").forEach((option) => {
  option.addEventListener("click", () => {
    const label = option.innerHTML;
    const value = option.getAttribute("data-value");
    selected.innerHTML = label;
    hiddenInput.value = value;
    options.style.display = "none";
  });
});

document.addEventListener("click", (e) => {
  if (!dropdown.contains(e.target)) {
    options.style.display = "none";
  }
});

// updates imageinput with the staged image's name
const imageInput = document.getElementById("imageInput");
const imageLabel = document.querySelector("label[for='imageInput']");

imageInput.addEventListener("change", () => {
  if (imageInput.files.length > 0) {
    const fileName = imageInput.files[0].name;
    const maxLen = 20;
    const truncated =
      fileName.length > maxLen ? fileName.slice(0, maxLen) + "…" : fileName;
    imageLabel.innerHTML = `<span style="text-decoration: underline;">${truncated}</span>`;
  } else {
    imageLabel.textContent = "Choose Image";
  }
});
