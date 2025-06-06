const poolData = {
  UserPoolId: "us-east-2_lXvCqndHZ",
  ClientId: "b2k3m380g08hmtmdn9osi12vg",
};
const userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);

// Get the username from the URL
const urlParams = new URLSearchParams(window.location.search);
const username = urlParams.get("username") || "";

// Populate the username field
document.getElementById("username").value = username;

document.getElementById("confirmBtn").addEventListener("click", () => {
  const code = document.getElementById("code").value.trim();
  if (!username || !code) {
    alert("Please enter username and confirmation code");
    return;
  }

  const cognitoUser = new AmazonCognitoIdentity.CognitoUser({
    Username: username,
    Pool: userPool,
  });

  cognitoUser.confirmRegistration(code, true, (err, result) => {
    if (err) {
      alert(err.message || JSON.stringify(err));
      return;
    }
    alert("Confirmation successful! Please log in.");
    window.location.href = "login.html";
  });
});

document.getElementById("resendBtn").addEventListener("click", () => {
  if (!username) {
    alert("Username missing");
    return;
  }

  const cognitoUser = new AmazonCognitoIdentity.CognitoUser({
    Username: username,
    Pool: userPool,
  });

  cognitoUser.resendConfirmationCode((err, result) => {
    if (err) {
      alert(err.message || JSON.stringify(err));
      return;
    }
    alert("Confirmation code resent! Check your email.");
  });
});
