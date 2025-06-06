const poolData = {
  UserPoolId: "us-east-2_lXvCqndHZ",
  ClientId: "b2k3m380g08hmtmdn9osi12vg",
};
const userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);

document.getElementById("signUpBtn").addEventListener("click", () => {
  const username = document.getElementById("username").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!username || !email || !password) {
    alert("Please fill in all fields");
    return;
  }

  const attributeList = [
    new AmazonCognitoIdentity.CognitoUserAttribute({
      Name: "email",
      Value: email,
    }),
  ];

  userPool.signUp(username, password, attributeList, null, (err, result) => {
    if (err) {
      alert(err.message || JSON.stringify(err));
      return;
    }

    alert(
      "Sign up successful! Please check your email for the confirmation code."
    );
    // Redirect to confirmation page with username
    window.location.href = `confirm.html?username=${encodeURIComponent(
      username
    )}`;
  });
});
