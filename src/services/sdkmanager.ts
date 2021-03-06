import { copy, readdir, remove } from 'fs-extra';
import * as Path from 'path';

import { AppSetting } from '../models/models';
import { execFileAsync, Standard } from './execpromise';

const isWindows = process.platform === 'win32';

/**
 * check agree android sdk license
 * @param sdkSetting SDK Setting values
 */
export async function checkLicenseAsync(sdkSetting: AppSetting): Promise<boolean> {
  const licensePath = Path.join(sdkSetting.sdkRootPath, 'licenses');
  // read license files
  const files = await readdir(licensePath).catch(e => []);
  // at least android sdk license exists
  return files.findIndex(file => /^android-sdk-license$/.test(file)) >= 0;
}

/**
 * exec `sdkmanager --list`
 * @param sdkSetting SDK Setting values
 */
export async function getListAsync(sdkSetting: AppSetting): Promise<Standard> {
  return await execSdkManagerAsync(sdkSetting, ['--list']);
}

/**
 * check done by sdkmanager.
 */
export async function checkDoneAsync(sdkSetting: AppSetting): Promise<boolean> {
  const std = await getListAsync(sdkSetting);
  return /done\r?\n?$/.test(std.out);
}

/**
 * parse sdkmanager get list
 */
export function parseList(stdout: string) {
  const packages: Package[] = [];

  const lines = stdout.split(/\r?\n/);
  let pointer = 0;

  // skip
  for (; pointer <= lines.length; pointer += 1) {
    if (lines[pointer].startsWith('done')) {
      return packages;
    } else if (lines[pointer].startsWith('Installed packages:')) {
      pointer += 2;
      break;
    }
  }

  // installed packages
  for (; pointer <= lines.length; pointer += 5) {
    if (lines[pointer].startsWith('done')) {
      return packages;
    } else if (lines[pointer].startsWith('Available Packages:')) {
      pointer += 2;
      break;
    }

    const p = new Package();
    p.state = InstallStates.Installed;
    p.rawName = lines[pointer];
    [p.name, p.category] = parsePackageName(p.rawName);
    p.description = lines[pointer + 1].slice(24);
    p.version = lines[pointer + 2].slice(24);
    p.installedLocation = lines[pointer + 3].slice(24);

    packages.push(p);
  }

  // available packages
  for (; pointer <= lines.length; ) {
    if (lines[pointer].startsWith('done')) {
      return packages;
    } else if (lines[pointer].startsWith('Available Updates:')) {
      pointer += 2;
      break;
    }

    // skip alrady installed
    if (packages.findIndex(pkg => pkg.rawName === lines[pointer]) === -1) {
      const p = new Package();
      p.state = InstallStates.Available;
      p.rawName = lines[pointer];
      [p.name, p.category] = parsePackageName(p.rawName);
      p.description = lines[pointer + 1].slice(24);
      p.version = lines[pointer + 2].slice(24);

      packages.push(p);
    }

    pointer += 2;
    // skip
    do {
      pointer += 1;
    } while (lines[pointer]);
    pointer += 1;
  }

  // available updates
  for (; pointer < lines.length; ) {
    if (lines[pointer].startsWith('done')) {
      break;
    }

    /*
    const upRawName = lines[pointer];
    const upLocalVersion = lines[pointer + 2].slice(20);
    const upRemoteVersion = lines[pointer + 2].slice(20);

    //skip
    pointer += 2;
    do {
      pointer += 1;
    } while (lines[pointer] && lines[pointer] === 'done');
    */
    pointer += 1;
  }

  return packages;
}

/**
 * exec `sdkmanager --install [package]`
 * @param sdkSetting SDK setting value
 * @param packageRawName package name
 */
export async function installPackageAsync(sdkSetting: AppSetting, packageRawName: string) {
  // before copy tools directory
  const tempDir = Path.join(sdkSetting.sdkRootPath, 'temp');
  await copy(Path.join(sdkSetting.sdkRootPath, 'tools'), tempDir);

  const std = await execSdkManagerAsync(sdkSetting, [`${packageRawName}`], true);

  // remove temp dir
  await remove(tempDir);

  return /done\r?\n?$/.test(std.out);
}

export function getSdkManagerPath(sdkSetting: AppSetting, useTmpToolsDir?: boolean) {
  let file = Path.join(sdkSetting.sdkRootPath, useTmpToolsDir ? 'temp' : 'tools' , 'bin', 'sdkmanager');
  if (isWindows) {
    file += '.bat';
  }
  return file;
}

/**
 * execute for `sdkmanager`
 * @param sdkSetting SDK setting value
 * @param args sdkmanager arguments
 */
async function execSdkManagerAsync(sdkSetting: AppSetting, args: string[], useTmpToolsDir?: boolean) {
  const file = getSdkManagerPath(sdkSetting, useTmpToolsDir);

  const commonArgs = ['--verbose', `--sdk_root=${sdkSetting.sdkRootPath}`];
  if (sdkSetting.useProxy) {
    commonArgs.push('--proxy=http');
    commonArgs.push(`--proxy_host=${sdkSetting.proxy}`);
    commonArgs.push(`--proxy_port=${sdkSetting.port}`);
  }

  console.log(`exec: ${file} ${commonArgs.concat(args).join(' ')}`);
  const std = await execFileAsync(file, commonArgs.concat(args));
  console.log(std.out);
  console.warn(std.err);

  return std;
}

function parsePackageName(name: string): [string, string] {
  const names = name.split(';');
  return [names[1] ? names.slice(1).join('; ') : names[0], names[0]];
}

export class Package {
  category: string;
  name: string;
  rawName: string;
  details: string[] | null;
  description: string;
  version: string;
  state: InstallStates;
  installedLocation: string | null;
}

export enum InstallStates {
  Installed = 'Installed',
  Available = 'Available',
  Updateable = 'Updateable'
}
