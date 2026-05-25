import Web3 from "web3";

const provider = window.ethereum || Web3.givenProvider || "https://rpc-amoy.polygon.technology";
const web3 = new Web3(provider);

export default web3;