const poolData = {
  UserPoolId: "us-east-2_lXvCqndHZ",
  ClientId: "b2k3m380g08hmtmdn9osi12vg",
};
const userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);
const OWNER_ID = "b19b5500-0021-70d5-4f79-c9966e8d1abd";
let editingPostId = null;

// Get fresh ID token from Cognito session
function getIdToken() {
  const user = userPool.getCurrentUser();
  return new Promise((resolve) => {
    if (!user) return resolve(null);
    user.getSession((err, session) => {
      if (err || !session.isValid()) return resolve(null);
      resolve(session.getIdToken().getJwtToken());
    });
  });
}
async function getUserIdFromToken() {
  const idToken = await getIdToken();
  if (!idToken) return null;
  const claims = parseJwt(idToken);
  return claims?.sub || null;
}

function parseJwt(token) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

async function getUsernameFromToken() {
  const idToken = await getIdToken();
  if (!idToken) return null;

  const claims = parseJwt(idToken);
  return claims?.["cognito:username"] || null;
}

const postForm = document.getElementById("postForm");
const postsSection = document.getElementById("posts");

// Load posts on page load
window.addEventListener("DOMContentLoaded", () => {
  updateHeader();
  loadPosts();
});

// submit/edit handler
postForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  removeValidationMessage();

  const titleInput = postForm.querySelector('input[name="title"]');
  const contentInput = postForm.querySelector('textarea[name="content"]');
  const tagInput = postForm.querySelector('input[name="tag"]');
  const formData = new FormData(postForm); // ✅ moved here
  const files = imageInput.files;

  if (!titleInput.value.trim()) {
    showValidationMessage("Give a title.");
    return;
  }

  const postId = editingPostId || crypto.randomUUID();
  const imageUrls = [];

  for (let i = 0; i < files.length; i++) {
    const url = await uploadImageToS3(files[i], postId, i);
    imageUrls.push(url);
  }

  const newPost = {
    id: editingPostId || postId,
    title: formData.get("title"),
    content: formData.get("content"),
    images: imageUrls,
    tag: formData.get("tag") || "general",
    layout: formData.get("layout") || "grid",
    timestamp: Date.now(),
    username: await getUsernameFromToken(),
    pageOwnerId: OWNER_ID,
  };

  const currentUserId = await getUserIdFromToken();
  if (currentUserId !== OWNER_ID) {
    newPost.tag = "guest";
  }

  const idToken = await getIdToken();
  if (!idToken) {
    showValidationMessage("Please log in to submit posts.");
    return;
  }

  const method = editingPostId ? "PUT" : "POST";
  const endpoint = "https://6bm2adpxck.execute-api.us-east-2.amazonaws.com/";

  if (editingPostId) {
    newPost.id = editingPostId;
  }

  try {
    const response = await fetch(endpoint, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(newPost),
    });

    if (!response.ok) {
      const errorData = await response.json();
      showValidationMessage(errorData.error || "Failed to submit post");
      return;
    }

    const idToScroll = editingPostId; // store before reset
    editingPostId = null;
    postForm.reset();
    previewContainer.innerHTML = "";
    layoutInput.value = "grid";
    layoutSelected.textContent = "Grid";
    layoutSelector.style.display = "none";
    // Reset image input label
    imageLabel.textContent = "Choose/Drop Image";
    imageInput.value = ""; // Clear actual file input
    loadPosts();

    // Scroll back to edited post
    setTimeout(() => {
      const updatedEl = document.querySelector(`[data-id="${idToScroll}"]`);
      if (updatedEl) {
        updatedEl.scrollIntoView({ behavior: "smooth", block: "center" });
        updatedEl.classList.add("just-edited");
        setTimeout(() => updatedEl.classList.remove("just-edited"), 1500);
      }
    }, 300);
  } catch (error) {
    showValidationMessage("Network error. Try again.");
  }
});

async function uploadImageToS3(file, postId, index) {
  const presignRes = await fetch(
    `https://6bm2adpxck.execute-api.us-east-2.amazonaws.com/?presign&post_id=${postId}&index=${index}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${await getIdToken()}` },
    }
  );
  const { upload_url, public_url } = await presignRes.json();

  await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg", "x-amz-acl": "public-read" },
    body: file,
  });

  return public_url;
}

function getTagColor(tag) {
  const option = document.querySelector(
    `.dropdown-option[data-value="${tag}"]`
  );
  return option?.dataset.color || "#ccc";
}

async function updateHeader() {
  const userControls = document.getElementById("user-controls");
  const idToken = await getIdToken();
  const dropdownWrapper = document.getElementById("tag-dropdown-wrapper");

  if (!idToken) {
    userControls.innerHTML = `
      <button onclick="location.href='signup.html'">Log In/Sign Up</button>
    `;
    if (dropdownWrapper) dropdownWrapper.style.display = "none";
    return;
  }

  const username = await getUsernameFromToken();
  const userId = await getUserIdFromToken();

  userControls.innerHTML = `
    <div id="username">Signed in as ${username}</div>
    <button id="logout">Log out</button>
  `;

  // Hide tag dropdown if user is not the owner
  if (userId !== OWNER_ID && dropdownWrapper) {
    dropdownWrapper.style.visibility = "hidden";
    dropdownWrapper.style.height = "0";
  }

  document.getElementById("logout").addEventListener("click", logout);
}

async function loadPosts() {
  const idToken = await getIdToken();
  let username = null;
  let userid = null;

  if (idToken) {
    userid = await getUserIdFromToken();
  } else {
    postForm.style.display = "none";
  }

  fetch("https://6bm2adpxck.execute-api.us-east-2.amazonaws.com/")
    .then((res) => {
      if (!res.ok) throw new Error("Failed to load posts");
      return res.json();
    })
    .then((posts) => {
      // Sort by timestamp (ascending: oldest first)
      posts.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      renderPosts(posts, userid); // pass sorted posts
    })
    .catch(() => {
      postsSection.innerHTML =
        "<p style='color:red; text-align:center;'>Failed to load posts.</p>";
    });
}

function renderGrid(images) {
  return `
    <div class="post-image-grid">
      ${images
        .map((url) => `<img src="${url}" alt="Image" class="grid-image">`)
        .join("")}
    </div>
  `;
}

function renderStack(images) {
  return `
    <div class="post-image-stack">
      ${images
        .map((url) => `<img src="${url}" alt="Image" class="stack-image">`)
        .join("")}
    </div>
  `;
}

function renderCarousel(images) {
  if (!images.length) return "";

  const id = "carousel-" + Math.random().toString(36).slice(2, 9);

  return `
    <div class="carousel-container" id="${id}">
      <div class="carousel-images">
        ${images
          .map(
            (url, i) =>
              `<img src="${url}" class="carousel-img ${
                i === 0 ? "active" : ""
              }">`
          )
          .join("")}
      </div>
      <div class="carousel-nav prev" onclick="changeSlide('${id}', -1)">‹</div>
      <div class="carousel-nav next" onclick="changeSlide('${id}', 1)">›</button>
    </div>
  `;
}

function renderPosts(posts, currentUserId = null) {
  postsSection.innerHTML = posts
    .slice()
    .reverse()
    .map((post) => {
      const tagLabel = post.tag.charAt(0).toUpperCase() + post.tag.slice(1);
      const color = getTagColor(post.tag);
      const username = post.username || "Unknown User";

      const isPostOwner = post.userId && post.userId === currentUserId;
      const isSiteOwner = currentUserId === OWNER_ID;

      const deleteBtn =
        isPostOwner || isSiteOwner
          ? `<button onclick="deletePost('${post.id}')">Delete</button>`
          : "";
      const editBtn = isPostOwner
        ? `<button onclick="editPost('${post.id}')">Edit</button>`
        : "";

      const signature = isPostOwner
        ? ""
        : `<small>Posted by <strong>${username}</strong></small>`;

      // 🔁 Add this image layout logic
      let imageHTML = "";
      if (Array.isArray(post.images) && post.images.length > 0) {
        switch (post.layout) {
          case "carousel":
            imageHTML = renderCarousel(post.images);
            break;
          case "stack":
            imageHTML = renderStack(post.images);
            break;
          case "grid":
          default:
            imageHTML = renderGrid(post.images);
        }
      } else if (post.image) {
        imageHTML = `<img src="${post.image}" alt="Post Image" class="preview-image">`;
      }

      return `
    <article class="post" data-id="${post.id}">
      <div class="tag-pill" style="--pill-color: ${color};" title="${tagLabel}">
        <span class="pill-label">${tagLabel}</span>
      </div>
      <h3>${post.title}</h3>
      <p>${(post.content || "").replace(/\n/g, "<br>")}</p>
      ${imageHTML}
      <div class="post-footer">
        <small>${new Date(post.timestamp).toLocaleString()}</small>
        ${signature}
        ${deleteBtn}
        ${editBtn}
      </div>
    </article>
  `;
    })
    .join("");

  requestAnimationFrame(() => {
    document.querySelectorAll(".post").forEach((el, i) => {
      setTimeout(() => el.classList.add("show"), i * 80);
    });
  });
}

function changeSlide(id, direction) {
  const container = document.getElementById(id);
  if (!container) return;

  const images = container.querySelectorAll(".carousel-img");
  const currentIndex = Array.from(images).findIndex((img) =>
    img.classList.contains("active")
  );
  if (currentIndex === -1) return;

  images[currentIndex].classList.remove("active");

  const nextIndex = (currentIndex + direction + images.length) % images.length;
  images[nextIndex].classList.add("active");
}

async function editPost(id) {
  const postEl = document.querySelector(`[data-id="${id}"]`);
  if (!postEl) return;

  postForm.scrollIntoView({ behavior: "smooth" });

  const response = await fetch(
    "https://6bm2adpxck.execute-api.us-east-2.amazonaws.com/"
  );
  const posts = await response.json();
  const post = posts.find((p) => p.id === id);
  if (!post) return;

  postForm.querySelector('input[name="title"]').value = post.title;
  postForm.querySelector('textarea[name="content"]').value = post.content;
  postForm.querySelector('input[name="tag"]').value = post.tag;
  layoutInput.value = post.layout || "grid";
  layoutSelected.textContent =
    (post.layout || "grid").charAt(0).toUpperCase() +
    (post.layout || "grid").slice(1);

  // 🟨 Show layout selector if multiple images
  layoutSelector.style.display = post.images?.length >= 2 ? "block" : "none";

  // 🟩 Show image previews
  previewContainer.innerHTML = "";
  if (layoutSelector) previewContainer.appendChild(layoutSelector);

  (post.images || []).forEach((url) => {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "Preview";
    img.classList.add("preview-image");
    previewContainer.appendChild(img);
  });

  editingPostId = id;
}

async function deletePost(id) {
  if (!confirm("Delete this post?")) return;

  const idToken = await getIdToken();
  if (!idToken) {
    alert("Please log in to delete posts.");
    return;
  }

  try {
    const response = await fetch(
      `https://6bm2adpxck.execute-api.us-east-2.amazonaws.com/?id=${encodeURIComponent(
        id
      )}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
      }
    );

    if (!response.ok) throw new Error("Delete failed");

    loadPosts();
  } catch (err) {
    alert("Failed to delete post.");
    console.error(err);
  }
}

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

function removeValidationMessage() {
  const existing = document.getElementById("form-error");
  if (existing) existing.remove();
}

// Dropdown handling
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

const imageDropZone = document.getElementById("image-drop-zone");
const imageInput = document.getElementById("imageInput");
const imageLabel = imageDropZone.querySelector("label");

imageDropZone.addEventListener("click", (e) => {
  if (e.target.tagName === "LABEL" || e.target === imageInput) {
    return; // Let the native behavior happen
  }
  imageInput.click(); // Only fire if clicking outside label/input
});

imageDropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  imageDropZone.classList.add("dragover");
});

imageDropZone.addEventListener("dragleave", () => {
  imageDropZone.classList.remove("dragover");
});

imageDropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  imageDropZone.classList.remove("dragover");

  if (e.dataTransfer.files.length > 0) {
    imageInput.files = e.dataTransfer.files;
    const fileName = e.dataTransfer.files[0].name;
    const maxLen = 20;
    const truncated =
      fileName.length > maxLen ? fileName.slice(0, maxLen) + "…" : fileName;
    imageLabel.innerHTML = `<span style="text-decoration: underline;">${truncated}</span>`;
    showImagePreview(e.dataTransfer.files);
  }
});

imageInput.addEventListener("change", () => {
  if (imageInput.files.length > 0) {
    const fileName = imageInput.files[0].name;
    const maxLen = 20;
    const truncated =
      fileName.length > maxLen ? fileName.slice(0, maxLen) + "…" : fileName;
    imageLabel.innerHTML = `<span style="text-decoration: underline;">${truncated}</span>`;
    showImagePreview(imageInput.files);
  } else {
    imageLabel.textContent = "Choose Image";
  }
});

const previewContainer = document.getElementById("image-preview-container");
const layoutSelector = document.getElementById("layout-selector");

function showImagePreview(files) {
  const existingSelector = document.getElementById("layout-selector");

  // Clear preview area but keep the layout dropdown
  previewContainer.innerHTML = "";
  if (existingSelector) previewContainer.appendChild(existingSelector);

  const layout = layoutInput.value || "grid";

  const imageUrls = [];

  const readAll = Array.from(files).map(
    (file) =>
      new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
      })
  );

  Promise.all(readAll).then((urls) => {
    urls.forEach((url) => imageUrls.push(url));

    let html = "";
    switch (layout) {
      case "carousel":
        html = renderCarousel(imageUrls);
        break;
      case "stack":
        html = renderStack(imageUrls);
        break;
      case "grid":
      default:
        html = renderGrid(imageUrls);
    }

    previewContainer.innerHTML = html;
    if (existingSelector) previewContainer.appendChild(existingSelector);
  });

  layoutSelector.style.display = files.length >= 2 ? "block" : "none";
}

function logout() {
  const poolData = {
    UserPoolId: "us-east-2_lXvCqndHZ",
    ClientId: "b2k3m380g08hmtmdn9osi12vg",
  };
  const userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);
  const cognitoUser = userPool.getCurrentUser();

  if (cognitoUser) {
    cognitoUser.signOut();
  }

  // Clear the token from localStorage
  localStorage.removeItem("idToken");

  // Redirect to login page or reload
  window.location.reload();
}

const logoutBtn = document.getElementById("logout");
if (logoutBtn) {
  logoutBtn.addEventListener("click", logout);
}

const layoutDropdown = document.getElementById("layout-selector");
const layoutSelected = layoutDropdown.querySelector(".selected-option");
const layoutOptions = layoutDropdown.querySelector(".dropdown-options");
const layoutInput = document.getElementById("layoutInput");

layoutSelected.addEventListener("click", () => {
  layoutOptions.style.display =
    layoutOptions.style.display === "block" ? "none" : "block";
});

layoutOptions.querySelectorAll(".dropdown-option").forEach((option) => {
  option.addEventListener("click", () => {
    const value = option.getAttribute("data-value");
    layoutSelected.textContent = option.textContent;
    layoutInput.value = value;
    layoutOptions.style.display = "none";

    // Re-render image preview using current files
    const currentFiles = imageInput.files;
    if (currentFiles && currentFiles.length > 0) {
      showImagePreview(currentFiles);
    }
  });
});

document.addEventListener("click", (e) => {
  if (!layoutDropdown.contains(e.target)) {
    layoutOptions.style.display = "none";
  }
});
