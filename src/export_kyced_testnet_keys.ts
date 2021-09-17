import client from "./utils/client";
import {TABLES} from "./utils/db_utils";
const bs58 = require("bs58");
const fs = require('fs');

(async () => {
  await client.connect();

  const result = await client.query(`
    SELECT * from ${TABLES.SolanaValidatorKYC}
    WHERE "kycStatus"='APPROVED_VERIFIED'
            AND "kycID"='MATCH' 
            AND "tdSPK" is not null
            AND "mbPK" is not null
            AND email not like '%opuslogica%'
            AND created_at > '2021-08-04'
            `);

  const rows = result.rows.reduce((acc, r) => {
    const decoded = bs58.decode(r.tdSPK)
    if (decoded.length !== 32) {
      console.log("BAD key:", r.tdSPK)
      return acc;
    }
    const match = r[r.tdSPK];
    if (!match || match.created_at > r.created_at) {
      acc[r.tdSPK] = r.created_at;
    }
    return acc;
  }, {});

  const sorted = Object.entries(rows).map(([tdSPK, created_at]) => {
    return {tdSPK, created_at}
  }).sort((a, b) => {
    return a.created_at > b.created_at ? 1 : -1
  })

  console.log('this many:', sorted.length);
  console.log(sorted);

  await fs.promises.writeFile('./tn_keys', JSON.stringify(sorted));

  // console.log(result.rows);
  process.exit(0);

})();
