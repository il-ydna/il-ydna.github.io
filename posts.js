const poolData = {
  UserPoolId: "us-east-2_lXvCqndHZ",
  ClientId: "b2k3m380g08hmtmdn9osi12vg",
};
const userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);
const OWNER_ID = "b19b5500-0021-70d5-4f79-c9966e8d1abd";

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

postForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const titleInput = postForm.querySelector('input[name="title"]');
  const contentInput = postForm.querySelector('textarea[name="content"]');
  const tagInput = postForm.querySelector('input[name="tag"]');

  removeValidationMessage();

  if (!titleInput.value.trim()) {
    showValidationMessage("Give a title.");
    return;
  }

  const formData = new FormData(postForm);
  const file = formData.get("image");

  let imageBase64 = "";
  if (file && file.size > 0) {
    imageBase64 = await toBase64(file);
  }

  const newPost = {
    title: formData.get("title"),
    content: formData.get("content"),
    image: imageBase64,
    tag: formData.get("tag") || "general",
    timestamp: Date.now(),
    username: await getUsernameFromToken(),
  };
  const currentUserId = await getUserIdFromToken();
  if (currentUserId !== OWNER_ID) {
    newPost.tag = "guest";
  }

  try {
    const idToken = await getIdToken();
    if (!idToken) {
      showValidationMessage("Please log in to submit posts.");
      return;
    }

    const response = await fetch(
      "https://6bm2adpxck.execute-api.us-east-2.amazonaws.com/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(newPost),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      showValidationMessage(errorData.error || "Failed to submit post");
      return;
    }

    postForm.reset();
    loadPosts();
  } catch (error) {
    showValidationMessage("Network error. Try again.");
  }
});

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

  if (idToken) {
    username = await getUsernameFromToken();
    document.getElementById(
      "username"
    ).textContent = `Signed in as ${username}`;
    postForm.style.display = "block";
  } else {
    postForm.style.display = "none";
  }

  fetch("https://6bm2adpxck.execute-api.us-east-2.amazonaws.com/")
    .then((res) => {
      if (!res.ok) throw new Error("Failed to load posts");
      return res.json();
    })
    .then((posts) => renderPosts(posts, username)) // pass username
    .catch(() => {
      postsSection.innerHTML =
        "<p style='color:red; text-align:center;'>Failed to load posts.</p>";
    });
}

function renderPosts(posts, currentUsername = null) {
  postsSection.innerHTML = posts
    .slice()
    .reverse()
    .map((post) => {
      const tagLabel = post.tag.charAt(0).toUpperCase() + post.tag.slice(1);
      const color = getTagColor(post.tag);
      const username = post.username || "Unknown User";

      const isOwner = currentUsername && post.username === currentUsername;
      const deleteBtn = isOwner
        ? `<button onclick="deletePost('${post.id}')">Delete</button>`
        : "";
      const signature = isOwner
        ? ""
        : `<small>Posted by <strong>${username}</strong></small>`;

      return `
        <article class="post" data-id="${post.id}">
          <div class="tag-pill" style="--pill-color: ${color};" title="${tagLabel}">
            <span class="pill-label">${tagLabel}</span>
          </div>
          <h3>${post.title}</h3>
          <p>${(post.content || "").replace(/\n/g, "<br>")}</p>
          ${post.image ? `<img src="${post.image}" alt="Post Image">` : ""}
          <div class="post-footer">
            <small>${new Date(post.timestamp).toLocaleString()}</small>
            ${signature}
            ${deleteBtn}
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

// Image label update
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
