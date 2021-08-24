import simpleGit, {SimpleGit} from 'simple-git';
import * as fs from "fs";
const yaml = require('js-yaml');
import {Cluster} from "./db_utils";
import * as path from "path";

const REPO_URL = 'git@github.com:solana-labs/stake-o-matic.wiki.git';
const REPO_LOCAL_PATH = 'stake-o-matic.wiki';


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

/**
 * Gets the data from the yml for the given cluster/epoch
 *
 * @param cluster
 * @param epoch
 */
export async function getEpochData(cluster: Cluster, epoch: number) {
  // data for epoch n is in `epoch-<n + 1>.yml`
  const filePath = path.join(REPO_LOCAL_PATH, `data-${cluster}`, `epoch-${epoch + 1}.yml`);
  console.log(`Loading epoch data from ${filePath}`);
  const file = await fs.promises.readFile(filePath);
  return yaml.load(file, {
    // yml sometimes has duplicates keys, which will cause yaml.load to throw an exception unless this argument is set
    json: true
  });
}


