// contracts/LoginTimestamp.sol
pragma solidity ^0.8.0;

contract LoginTimestamp {
    struct LoginDetails {
        address dataScientist;
        uint256 timestamp;
    }

    // Mapping from data scientist's address to their login details
    mapping(address => LoginDetails) public logins;

    // Event to emit the login details
    event LoginRecorded(address indexed dataScientist, uint256 timestamp);

    // Function to record the login timestamp
    function recordLogin() public {
        logins[msg.sender] = LoginDetails(msg.sender, block.timestamp);
        emit LoginRecorded(msg.sender, block.timestamp);
    }

    // Function to retrieve login timestamp by address
    function getLoginDetails(address _dataScientist) public view returns (address, uint256) {
        LoginDetails memory details = logins[_dataScientist];
        return (details.dataScientist, details.timestamp);
    }
}
