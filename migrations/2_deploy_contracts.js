const LoginTimestamp = artifacts.require("LoginTimestamp");

module.exports = function (deployer) {
  deployer.deploy(LoginTimestamp);
};
