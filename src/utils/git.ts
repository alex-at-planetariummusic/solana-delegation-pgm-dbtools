import simpleGit, {SimpleGit} from 'simple-git';
import * as fs from "fs";
const yaml = require('js-yaml');
import {Cluster} from "./db_utils";
import * as path from "path";

const REPO_URL = 'git@github.com:solana-labs/stake-o-matic.wiki.git';
const REPO_LOCAL_PATH = 'stake-o-matic.wiki';

Cluster.Testnet

/**
 * Starting with these epochs, the yml files in stake-o-matic.wiki contain all the information we need to export data to the database
 */
const NEW_YML_SCHEMA_EPOCH = {
  [Cluster.Testnet]: 222,
  [Cluster.MainnetBeta]: 214
}

export async function loadRepo() {
  console.log('Loading stake-o-matic.wiki...');

  const repo_exists = await fs.promises.stat(REPO_LOCAL_PATH).catch(e => false);
  if (repo_exists) {
    const git: SimpleGit = simpleGit(REPO_LOCAL_PATH);
    await git.checkout('master');
    await git.pull('origin', 'master');
  } else {
    const git: SimpleGit = simpleGit();
    await fs.promises.mkdir(REPO_LOCAL_PATH);
    await git.clone(REPO_URL, REPO_LOCAL_PATH);
    await git.checkout('master');
    await git.pull('origin', 'master');
  }
}


const epochMatcher = /epoch-(\d+).yml/;

export async function getEpochsForCluster(cluster: Cluster): Promise<number[]> {
  const dirContents = await fs.promises.readdir(path.join(REPO_LOCAL_PATH, `data-${cluster}`))

  return dirContents.reduce((a, f) => {
    const match = f.match(epochMatcher);
    if (match && match[1] && (Number(match[1]) - 1 >= NEW_YML_SCHEMA_EPOCH[cluster])) {
      // Data for epoch N is in file epoch-{N-1}.yml
      a.push(Number(match[1]) - 1);
    }

    return a;
  }, []);
}

/**
 * Gets the data from the yml for the given cluster/epoch
 *
 * @param cluster
 * @param epoch
 */
export async function getEpochData(cluster: Cluster, epoch: number): Promise<Record<string, any>> {
  // data for epoch n is in `epoch-<n + 1>.yml`
  const filePath = path.join(REPO_LOCAL_PATH, `data-${cluster}`, `epoch-${epoch + 1}.yml`);
  console.log(`Loading epoch data from ${filePath}`);
  const file = await fs.promises.readFile(filePath);
  return yaml.load(file, {
    // yml sometimes has duplicates keys, which will cause yaml.load to throw an exception unless this argument is set
    json: true
  });
}


