import client from "./utils/client";
import {TABLES} from "./utils/db_utils";
import {Participant} from "./utils/constants";
import {
  getDelegationProgramAccounts,
  getParsedDelegationProgramAccounts
} from "./utils/rpc_utils";

const csv = require('csvtojson')

const JUMIO_SHEET = '../test_23082021(1).csv';
const PUBLIC_REGISTRY_SHEET = '../Solana - Public Registry (12.May.2021) - Public Sheet.csv';
const PRIVATE_REGISTRY_SHEET = '../Validator Registry - Validator Contact Info.csv';

/**
 * key: {
 *   contact: row from contact sheet,
 *   jumio: row from jumio sheet,
 *   public: row from public sheet
 * }
 */
interface JoinedSheet {
  registrationKeys?: any,
  kycDB?: any,
  contact?: any,
  jumio?: any,
  public?: any,
  participant?: Participant
}

(async () => {
  // console.log(jumio)
  await client.connect();

  // await findDuplicateRegistrations();

  const joinedSheets: Record<string, JoinedSheet> = {}

  const registrationKeys = await updateKeypairTableWithPubkey();

  Object.entries(registrationKeys).forEach(([k, v]) => {
    joinedSheets[k] = {
      registrationKeys: v
    }
  })

  // Process the contact sheet
  const contactSheet = await parseContactSheet();

  let solanaValidatorKYCMatchCount = 0;
  let solanaValidatorKYCOverMatchCount = 0;

  let solanaValidatorKYCRowsToPrune = [];


  for (const [keykey, contact] of Object.entries(contactSheet)) {
    // console.log('doing', contact);
    const testnetKey = contact['testnet_key'];
    const mainnetKey = trimmedOrNull(contact['mainnet_key']);

    let validatorKYCMatchResult;
    if (mainnetKey) {
      validatorKYCMatchResult = await client.query(
        `SELECT * FROM ${TABLES.SolanaValidatorKYC}
            WHERE "tdSPK"=$1 AND
            "mbPK"=$2`,
        [
          testnetKey,
          mainnetKey
        ]);
    } else if (testnetKey) {
      validatorKYCMatchResult = await client.query(
        `SELECT * FROM ${TABLES.SolanaValidatorKYC}
            WHERE "tdSPK"=$1`,
        [
          testnetKey
        ]);

    } else {
      console.error('no tn or mn key');
    }

    let validatorKYCMatchRow = null;
    if (validatorKYCMatchResult.rows.length == 1) {
      validatorKYCMatchRow = validatorKYCMatchResult.rows[0];
      solanaValidatorKYCMatchCount++;
    } else if (validatorKYCMatchResult.rows.length > 1) {
      // console.log(`${validatorKYCMatchResult.rows.length} matches for ${keykey}`);

      // Pick the r
      validatorKYCMatchRow = validatorKYCMatchResult.rows.reduce((acc, r) => {
        // console.log(r);
        if (!acc) {
          acc = r;
        } else {
          //
          const accBlank = isBlankOrFalsy(acc['mbPK']);
          const rBlank = isBlankOrFalsy(r['mbPK']);
          if (!rBlank && accBlank) { // r has a mainnet key and acc doesn't. So r is preferred
            solanaValidatorKYCRowsToPrune.push(acc.id);
            acc = r;
          } else if (((rBlank && accBlank) && (!rBlank && !accBlank)) && r.id > acc.id) { // neither have mainnet keys, so prefer the newer
            solanaValidatorKYCRowsToPrune.push(acc.id);
            acc = r;
          } else {
            solanaValidatorKYCRowsToPrune.push(r.id);
          }
        }
        return acc
      }, null);
      solanaValidatorKYCOverMatchCount++;
    }

    joinedSheets[keykey] = joinedSheets[keykey] || {};
    Object.assign(joinedSheets[keykey], {
      registrationKeys: registrationKeys[keykey],
      kycDB: validatorKYCMatchRow,
      contact: contact
    })
  }
  console.log('prune:', solanaValidatorKYCRowsToPrune);


  console.log('matches:', solanaValidatorKYCMatchCount);
  console.log('over matches:', solanaValidatorKYCOverMatchCount);

  ///////////////////////////////////////////////
  // now look for matches with the jumio entries
  const jumioRows = await parseJumioSheet();
  for (let [jumioID, jumioRow] of Object.entries(jumioRows)) {
    // first search for match in rows we already have
    const sheetMatch = Object.entries(joinedSheets).find(([k, v]) => {
      return jumioID === v.kycDB?.jumioID;
    });
    if (sheetMatch) {
      // console.log('kyc sheetMatch on', jumioID);
      sheetMatch['jumio'] = sheetMatch;
      continue;
    }

    // search in db

    const kycRowMatch = await client.query(`SELECT * FROM ${TABLES.SolanaValidatorKYC}
            WHERE "jumioID"=$1`,
      [
        jumioID
      ]);

    if (kycRowMatch.rows.length === 1) {
      const kycRow = kycRowMatch.rows[0];
      // console.log('kyc DBMatch on', jumioID);

      joinedSheets[keypairToToken(kycRow.tdSPK, kycRow.mbPK)] = {
        kycDB: kycRow,
        jumio: jumioRow
      }
    } else if (kycRowMatch.rows.length === 0) {
      // do nothing; maybe a "vanilla" kyc
    } else if (kycRowMatch.rows.length > 1) {
      console.warn('Multiple matches for jumioID:', jumioID);
    }
  }


  // loop through the public registry to find matches. The only data we import from the public registry is the tds stage (I think)
  const publicRegistry = await parsePublicRegistry();
  for (const [keykey, publicRow] of Object.entries(publicRegistry)) {

    if (joinedSheets[keykey]) {
      // console.log('SOMETHIN\' for ', keykey);
      joinedSheets[keykey].public = publicRow;
      continue;
    }
    // console.log('nothin\' for ', keykey);
  }
  /// NOW we've got everything. Update or insert into the KYC table

  const joinedSheetsValues = Object.values(joinedSheets);
  console.log(`${joinedSheetsValues.length} rows to insert or update`);

  client.query(`BEGIN`)

  for (let i = 0; i < joinedSheetsValues.length; i++) {
    const joinedSheet = joinedSheetsValues[i];


    if (!joinedSheet.kycDB && !joinedSheet.contact && !joinedSheet.public) { // nothing to import; skip
      continue;
    }

    const values: Record<string, any> = {};

    // prefer name from the contact sheet
    if (joinedSheet.contact?.firstName) {
      values.firstName = joinedSheet.contact?.firstName;
    }
    if (joinedSheet.contact?.lastName) {
      values.lastName = joinedSheet.contact?.lastName;
    }

    if (joinedSheet.jumio) {
      values.kycID = trimmedOrNull(joinedSheet.jumio.Similarity)
      values.kycStatus = trimmedOrNull(joinedSheet.jumio['Verification Status']);
    } else if (joinedSheet.public?.['KYC Status']) {
      if (joinedSheet.public?.['KYC Status'] === 'Complete') {
        values.kycID = 'Match';
        values.kycStatus = 'APPROVED_VERIFIED';
      }
    }

    if (joinedSheet.public?.['Foundation Delegation Program Onboarding Group']) {
values.tds_onboarding_group = joinedSheet.public?.['Foundation Delegation Program Onboarding Group'];
    }

    values.email = trimmedOrNull(joinedSheet.contact?.email) || trimmedOrNull(joinedSheet.kycDB?.email);
    values.alternate_email = trimmedOrNull(joinedSheet.contact?.alternate_email);
    values.discordID = trimmedOrNull(joinedSheet.contact?.discordID) || trimmedOrNull(joinedSheet.kycDB?.['Discord ID']);
    values.tdSPK = joinedSheet.registrationKeys?.testnet_key || trimmedOrNull(joinedSheet.kycDB?.tdSPK) || trimmedOrNull(joinedSheet.contact?.mainnet_key);
    values.mbPK = joinedSheet.registrationKeys?.mainnet_key || trimmedOrNull(joinedSheet.kycDB?.mbPK) || trimmedOrNull(joinedSheet.contact?.testnet_key);
    if (joinedSheet.registrationKeys) {
      values.pubkey = trimmedOrNull(joinedSheet.registrationKeys.pubkey);
    }

    const transactionID = trimmedOrNull(joinedSheet.jumio?.['Scan reference']);
    if (transactionID) {
      values.transactionID = transactionID;
    }

    if (!joinedSheet.kycDB?.country && joinedSheet.contact?.isInUSA) {
      values.country = 'us';
    }


    if (joinedSheet.kycDB) { // already a DB row; UPDATE

      const params = []
      const setSql = Object.entries(values).map(([k, v], idx) => {
        params[idx] = v;
        return `"${k}"=$${idx + 1}`
      }).join(',');

      params.push(joinedSheet.kycDB.id);

      await client.query(
        `UPDATE ${TABLES.SolanaValidatorKYC}
        SET ${setSql}
          WHERE id=$${params.length}`,
        params
      )

    } else {
      const valueNames = []
      const insertValues = []
      const valueHolders = []; // what _are_ the $1, $2s called?
      Object.entries(values).forEach(([k, v], idx) => {
        insertValues[idx] = v;
        valueHolders[idx] = `$${idx + 1}`;
        valueNames[idx] = `"${k}"`;
      })
      console.log(joinedSheet);
      const insertQueryString = `INSERT  
        INTO ${TABLES.SolanaValidatorKYC}
        (${valueNames.join(',')})
        VALUES (${valueHolders.join(',')})
        `;
      console.log(insertValues);
      console.log(insertQueryString);
      await client.query(
        insertQueryString,
        insertValues
      );
    }
  }

  await client.query(
    `DELETE FROM ${TABLES.SolanaValidatorKYC} 
    WHERE id in (${solanaValidatorKYCRowsToPrune.join(',')})`
  )

  console.log('COMMIT transaction');
  await client.query(`COMMIT`);
  console.log('DONE!!!');
  process.exit(0);

})();

function isBlankOrFalsy(val) {
  return !val || !!val.length || val.trim().length > 0;
}

function keypairToToken(testnetKey, mainnetKey) {
  return `${testnetKey} - ${mainnetKey}`;
}


async function parseJumioSheet(): Promise<Record<string, any>> {
  const jumio = await csv().fromFile(JUMIO_SHEET)

  return jumio.reduce((acc, row) => {
    acc[row['Customer Internal Reference']] = {
      kycStatus: row['Verification status'],
      kycID: row['Similarity'],
    }

    return acc;
  }, {})
}

async function parseContactSheet(): Promise<Record<string, any>> {
  const privateSheet = await csv().fromFile(PRIVATE_REGISTRY_SHEET)

  return privateSheet.reduce((acc, row) => {
    // console.log(row);

    const newRow: Record<string, any> = {}

    newRow.testnet_key = row['TdS Pubkey'];
    newRow.mainnet_key = row['MB Pubkey'];

    if (row.Name?.length > 0) {

      const match = row.Name.match(/([^\s]+)\s*(.*)$/);
      if (match) {
        if (!match[2]) { // no space assume it's the last name (which it might not be...)
          newRow.lastName = match[1].trim();
        } else {
          newRow.firstName = match[1].trim();
          newRow.lastName = match[2].trim();
        }
      }
    }

    newRow.tds_stage = row['First TdS Stage'];
    newRow.email = row['Email Address'];
    newRow.alternate_email = row['Alternate Email used for KYC lookup'];
    newRow.keybase_username = row['Keybase'];
    newRow.discordID = row['Discord ID'];
    newRow.isInUSA = row['Is in USA'] === '1';

    // if (newRow.email === 'darkheretik@gmail.com') {
    //   console.log(newRow);
    //   process.exit(0);
    // }

    const keykey = keypairToToken(newRow.testnet_key, newRow.mainnet_key);

    if (acc[keykey]) {
      console.warn(`Private contacts: Duplicate record for "${keykey}; overwriting`);
    }

    acc[keypairToToken(newRow.testnet_key, newRow.mainnet_key)] = newRow;

    return acc;
  }, {});

}

function trimmedOrNull(string) {
  return string && string.trim().length !== 0 ? string.trim() : null
}


async function parsePublicRegistry(): Promise<Record<string, any>> {
  const sheet = await csv().fromFile(PUBLIC_REGISTRY_SHEET);
  return sheet.reduce((acc, r) => {
    // console.log(r);

    const keykey = keypairToToken(r['TdS Pubkey'], r['MB Pubkey']);
    if (acc[keykey]) {
      console.warn(`Public registry: Duplicate record for "${keykey}; overwriting`);
    }

    acc[keykey] = r;

    return acc;
  }, {});
}

async function updateKeypairTable() {
  const delegationProgramAccounts = await getDelegationProgramAccounts();

}

async function updateKeypairTableWithPubkey() {

  const keys = {};

  const participants = await getParsedDelegationProgramAccounts()
  for (let i = 0; i < participants.length; i++) {
    const participant = participants[i];
    const keyObject = {
      testnet_key: participant.testnet_identity.toBase58(),
      mainnet_key: participant.mainnet_identity.toBase58(),
      pubkey: participant.pubkey.toBase58()
    }

    keys[keypairToToken(keyObject.testnet_key, keyObject.mainnet_key)] = keyObject;

    // const tk = participant.testnet_identity.toBase58();
    // const mk = participant.mainnet_identity.toBase58();
    // const pubkey = ;

    const matchingKeypairRow = await client.query(
      `SELECT id
      FROM ${TABLES.ValidatorKeyPair}
      WHERE testnet_pk = $1 AND
            mainnet_beta_pk=$2`,
      [
        keyObject.testnet_key,
        keyObject.mainnet_key
      ]
    );

    if (matchingKeypairRow.rows.length === 1) { // shouldn't be > 1
      await client.query(
        `UPDATE ${TABLES.ValidatorKeyPair}
        SET pubkey=$1,
            state=$2
        WHERE id=$3`,
        [
          keyObject.pubkey,
          participant.state,
          matchingKeypairRow.rows[0].id
        ]
      )
    } else {
      await client.query(
        `INSERT INTO ${TABLES.ValidatorKeyPair} (
            testnet_pk,
            mainnet_beta_pk,
            pubkey,
            state
         ) VALUES ($1, $2, $3, $4)`,
        [
          keyObject.testnet_key,
          keyObject.mainnet_key,
          keyObject.pubkey,
          participant.state
        ]
      );
    }
  }


  // If pubkey is not set, the registration was deleted
  await client.query(`DELETE FROM ${TABLES.ValidatorKeyPair} WHERE pubkey is null`);


  return keys;
}

