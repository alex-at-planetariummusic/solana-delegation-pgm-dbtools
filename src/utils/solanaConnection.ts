import {Connection, clusterApiUrl} from "@solana/web3.js";

// import {ConnectionConfig} from "@solana/web3.js";
// const config: ConnectionConfig = {
//   encoding: "jsonParsed"
// };

export default new Connection(
  clusterApiUrl("mainnet-beta")
);
