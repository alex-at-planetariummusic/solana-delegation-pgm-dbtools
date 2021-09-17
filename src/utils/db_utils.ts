import {QueryResult} from "pg";
import client from "./client";

export enum EpochStat {
  None = 'None',
  Baseline = 'Baseline',
  Bonus = 'Bonus',
}

export enum Cluster {
  Testnet = 'testnet',
  MainnetBeta = 'mainnet-beta'
}

export const TABLES = {
  EpochStats: '"EpochStats"',
  SolanaValidatorKYC: '"SolanaValidatorKYC"',
  ValidatorStats: '"ValidatorStats"',
  ValidatorEpochStats: '"ValidatorEpochStats"',
  ValidatorKeyPair: '"ValidatorKeyPair"'
};

const mostRecentEpochCache = {}

/**
 * Returns the most recent epoch number that is in the database
 *
 * memoized
 *
 * @param {Cluster} cluster
 */
export async function getMostRecentEpochInDBForCluster(cluster: Cluster): Promise<number> {
  if (!mostRecentEpochCache[cluster]) {
    const res: QueryResult = await client.query(
      `SELECT max(epoch) as epoch 
        FROM ${TABLES.EpochStats}
        WHERE cluster=$1`,
      [cluster]
    )

    if (res.rows.length !== 1) {
      throw new Error(`No max epoch found for ${cluster}`);
    }
    mostRecentEpochCache[cluster] = res.rows[0].epoch;
  }

  return mostRecentEpochCache[cluster]
}


export async function getEpochsInDbForCluster(cluster: Cluster): Promise<number[]> {
  const res: QueryResult = await client.query(
    `SELECT epoch  
        FROM ${TABLES.EpochStats}
        WHERE cluster=$1`,
    [cluster]
  )

  return res.rows.map(r => r.epoch);
}
