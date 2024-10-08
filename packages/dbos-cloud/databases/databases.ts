import axios, { AxiosError } from "axios";
import { isCloudAPIErrorResponse, handleAPIErrors, getCloudCredentials, getLogger, sleepms, dbosConfigFilePath } from "../cloudutils.js";
import { Logger } from "winston";
import { ConfigFile, loadConfigFile, writeConfigFile } from "../configutils.js";
import { copyFileSync, existsSync } from "fs";

export interface UserDBInstance {
  readonly PostgresInstanceName: string;
  readonly Status: string;
  readonly HostName: string;
  readonly Port: number;
  readonly DatabaseUsername: string;
}

function isValidPassword(logger: Logger, password: string): boolean {
  if (password.length < 8 || password.length > 128) {
    logger.error("Invalid database password. Passwords must be between 8 and 128 characters long");
    return false;
  }
  if (password.includes("/") || password.includes('"') || password.includes("@") || password.includes(" ") || password.includes("'")) {
    logger.error("Password contains invalid character. Passwords can contain any ASCII character except @, /, \\, \", ', and spaces");
    return false;
  }
  return true;
}

export async function createUserDb(host: string, dbName: string, appDBUsername: string, appDBPassword: string, sync: boolean) {
  const logger = getLogger();
  const userCredentials = await getCloudCredentials();
  const bearerToken = "Bearer " + userCredentials.token;

  if (!isValidPassword(logger, appDBPassword)) {
    return 1;
  }

  try {
    await axios.post(
      `https://${host}/v1alpha1/${userCredentials.organization}/databases/userdb`,
      { Name: dbName, AdminName: appDBUsername, AdminPassword: appDBPassword },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: bearerToken,
        },
      }
    );

    logger.info(`Successfully started provisioning database: ${dbName}`);

    if (sync) {
      let status = "";
      while (status !== "available" && status !== "backing-up") {
        if (status === "") {
          await sleepms(5000); // First time sleep 5 sec
        } else {
          await sleepms(30000); // Otherwise, sleep 30 sec
        }
        const userDBInfo = await getUserDBInfo(host, dbName);
        logger.info(userDBInfo);
        status = userDBInfo.Status;
      }
    }
    logger.info(`Database successfully provisioned!`);
    return 0;
  } catch (e) {
    const errorLabel = `Failed to create database ${dbName}`;
    const axiosError = e as AxiosError;
    if (isCloudAPIErrorResponse(axiosError.response?.data)) {
      handleAPIErrors(errorLabel, axiosError);
    } else {
      logger.error(`${errorLabel}: ${(e as Error).message}`);
    }
    return 1;
  }
}

export async function linkUserDB(host: string, dbName: string, hostName: string, port: number, dbPassword: string, enableTimetravel: boolean) {
  const logger = getLogger();
  const userCredentials = await getCloudCredentials();
  const bearerToken = "Bearer " + userCredentials.token;

  if (!isValidPassword(logger, dbPassword)) {
    return 1;
  }

  logger.info(`Linking Postgres instance ${dbName} to DBOS Cloud. Hostname: ${hostName} Port: ${port} Time travel: ${enableTimetravel}`);
  try {
    await axios.post(
      `https://${host}/v1alpha1/${userCredentials.organization}/databases/byod`,
      { Name: dbName, HostName: hostName, Port: port, Password: dbPassword, captureProvenance: enableTimetravel },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: bearerToken,
        },
      }
    );

    logger.info(`Database successfully linked!`);
    return 0;
  } catch (e) {
    const errorLabel = `Failed to link database ${dbName}`;
    const axiosError = e as AxiosError;
    if (isCloudAPIErrorResponse(axiosError.response?.data)) {
      handleAPIErrors(errorLabel, axiosError);
    } else {
      logger.error(`${errorLabel}: ${(e as Error).message}`);
    }
    return 1;
  }
}

export async function deleteUserDb(host: string, dbName: string) {
  const logger = getLogger();
  const userCredentials = await getCloudCredentials();
  const bearerToken = "Bearer " + userCredentials.token;

  try {
    await axios.delete(`https://${host}/v1alpha1/${userCredentials.organization}/databases/userdb/${dbName}`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: bearerToken,
      },
    });
    logger.info(`Database deleted: ${dbName}`);
    return 0;
  } catch (e) {
    const errorLabel = `Failed to delete database ${dbName}`;
    const axiosError = e as AxiosError;
    if (isCloudAPIErrorResponse(axiosError.response?.data)) {
      handleAPIErrors(errorLabel, axiosError);
    } else {
      logger.error(`${errorLabel}: ${(e as Error).message}`);
    }
    return 1;
  }
}

export async function unlinkUserDB(host: string, dbName: string) {
  const logger = getLogger();
  const userCredentials = await getCloudCredentials();
  const bearerToken = "Bearer " + userCredentials.token;

  try {
    await axios.delete(`https://${host}/v1alpha1/${userCredentials.organization}/databases/byod/${dbName}`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: bearerToken,
      },
    });
    logger.info(`Database unlinked: ${dbName}`);
    return 0;
  } catch (e) {
    const errorLabel = `Failed to unlink database ${dbName}`;
    const axiosError = e as AxiosError;
    if (isCloudAPIErrorResponse(axiosError.response?.data)) {
      handleAPIErrors(errorLabel, axiosError);
    } else {
      logger.error(`${errorLabel}: ${(e as Error).message}`);
    }
    return 1;
  }
}

export async function getUserDb(host: string, dbName: string, json: boolean) {
  const logger = getLogger();

  try {
    const userDBInfo = await getUserDBInfo(host, dbName);
    if (json) {
      console.log(JSON.stringify(userDBInfo));
    } else {
      console.log(`Postgres Instance Name: ${userDBInfo.PostgresInstanceName}`);
      console.log(`Status: ${userDBInfo.Status}`);
      console.log(`Host Name: ${userDBInfo.HostName}`);
      console.log(`Port: ${userDBInfo.Port}`);
      console.log(`Database Username: ${userDBInfo.DatabaseUsername}`);
    }
    return 0;
  } catch (e) {
    const errorLabel = `Failed to retrieve database record ${dbName}`;
    const axiosError = e as AxiosError;
    if (isCloudAPIErrorResponse(axiosError.response?.data)) {
      handleAPIErrors(errorLabel, axiosError);
    } else {
      logger.error(`${errorLabel}: ${(e as Error).message}`);
    }
    return 1;
  }
}

export async function listUserDB(host: string, json: boolean) {
  const logger = getLogger();

  try {
    const userCredentials = await getCloudCredentials();
    const bearerToken = "Bearer " + userCredentials.token;

    const res = await axios.get(`https://${host}/v1alpha1/${userCredentials.organization}/databases`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: bearerToken,
      },
    });

    const userDBs = res.data as UserDBInstance[];
    if (json) {
      console.log(JSON.stringify(userDBs));
    } else {
      if (userDBs.length === 0) {
        logger.info("No database instances found");
      }
      userDBs.forEach((userDBInfo) => {
        console.log(`Postgres Instance Name: ${userDBInfo.PostgresInstanceName}`);
        console.log(`Status: ${userDBInfo.Status}`);
        console.log(`Host Name: ${userDBInfo.HostName}`);
        console.log(`Port: ${userDBInfo.Port}`);
        console.log(`Database Username: ${userDBInfo.DatabaseUsername}`);
      });
    }
    return 0;
  } catch (e) {
    const errorLabel = `Failed to retrieve info`;
    const axiosError = e as AxiosError;
    if (isCloudAPIErrorResponse(axiosError.response?.data)) {
      handleAPIErrors(errorLabel, axiosError);
    } else {
      logger.error(`${errorLabel}: ${(e as Error).message}`);
    }
    return 1;
  }
}

export async function getUserDBInfo(host: string, dbName: string): Promise<UserDBInstance> {
  const userCredentials = await getCloudCredentials();
  const bearerToken = "Bearer " + userCredentials.token;

  const res = await axios.get(`https://${host}/v1alpha1/${userCredentials.organization}/databases/userdb/info/${dbName}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: bearerToken,
    },
  });

  return res.data as UserDBInstance;
}

export async function resetDBCredentials(host: string, dbName: string, appDBPassword: string) {
  const logger = getLogger();
  const userCredentials = await getCloudCredentials();
  const bearerToken = "Bearer " + userCredentials.token;

  if (!isValidPassword(logger, appDBPassword)) {
    return 1;
  }

  try {
    await axios.post(
      `https://${host}/v1alpha1/${userCredentials.organization}/databases/userdb/${dbName}/credentials`,
      { Password: appDBPassword },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: bearerToken,
        },
      }
    );
    logger.info(`Successfully reset user password for database: ${dbName}`);
    return 0;
  } catch (e) {
    const errorLabel = `Failed to reset user password for database ${dbName}`;
    const axiosError = e as AxiosError;
    if (isCloudAPIErrorResponse(axiosError.response?.data)) {
      handleAPIErrors(errorLabel, axiosError);
    } else {
      logger.error(`${errorLabel}: ${(e as Error).message}`);
    }
    return 1;
  }
}

export async function restoreUserDB(host: string, dbName: string, targetName: string, restoreTime: string, sync: boolean) {
  const logger = getLogger();
  const userCredentials = await getCloudCredentials();
  const bearerToken = "Bearer " + userCredentials.token;

  try {
    await axios.post(
      `https://${host}/v1alpha1/${userCredentials.organization}/databases/userdb/${dbName}/restore`,
      { RestoreName: targetName, RestoreTimestamp: restoreTime },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: bearerToken,
        },
      }
    );
    logger.info(`Successfully started restoring database: ${dbName}! New database name: ${targetName}, restore time: ${restoreTime}`);

    if (sync) {
      let status = "";
      while (status !== "available" && status !== "backing-up") {
        if (status === "") {
          await sleepms(5000); // First time sleep 5 sec
        } else {
          await sleepms(30000); // Otherwise, sleep 30 sec
        }
        const userDBInfo = await getUserDBInfo(host, targetName);
        logger.info(userDBInfo);
        status = userDBInfo.Status;
      }
    }
    logger.info(`Database successfully restored! New database name: ${targetName}, restore time: ${restoreTime}`);
    return 0;
  } catch (e) {
    const errorLabel = `Failed to restore database ${dbName}`;
    const axiosError = e as AxiosError;
    if (isCloudAPIErrorResponse(axiosError.response?.data)) {
      handleAPIErrors(errorLabel, axiosError);
    } else {
      logger.error(`${errorLabel}: ${(e as Error).message}`);
    }
    return 1;
  }
}

export async function connect(host: string, dbName: string, password: string) {
  const logger = getLogger();

  try {
    if(!existsSync(dbosConfigFilePath)) {
      logger.error(`Error: ${dbosConfigFilePath} not found`);
      return 1;
    }

    const backupConfigFilePath = `dbos-config.yaml.${Date.now()}.bak`;
    logger.info(`Backing up ${dbosConfigFilePath} to ${backupConfigFilePath}`);
    copyFileSync(dbosConfigFilePath, backupConfigFilePath);

    logger.info("Retrieving cloud database info...");
    const userDBInfo = await getUserDBInfo(host, dbName);
    console.log(`Postgres Instance Name: ${userDBInfo.PostgresInstanceName}`);
    console.log(`Host Name: ${userDBInfo.HostName}`);
    console.log(`Port: ${userDBInfo.Port}`);
    console.log(`Database Username: ${userDBInfo.DatabaseUsername}`);
    console.log(`Status: ${userDBInfo.Status}`);

    logger.info(`Loading cloud database connection information into ${dbosConfigFilePath}...`)
    const config: ConfigFile = loadConfigFile(dbosConfigFilePath);
    config.database.hostname = userDBInfo.HostName;
    config.database.port = userDBInfo.Port;
    config.database.username = userDBInfo.DatabaseUsername;
    config.database.password = password;
    writeConfigFile(config, dbosConfigFilePath);
    logger.info(`Cloud database connection information loaded into ${dbosConfigFilePath}`)
    return 0;
  } catch (e) {
    const errorLabel = `Failed to retrieve database record ${dbName}`;
    const axiosError = e as AxiosError;
    if (isCloudAPIErrorResponse(axiosError.response?.data)) {
      handleAPIErrors(errorLabel, axiosError);
    } else {
      logger.error(`${errorLabel}: ${(e as Error).message}`);
    }
    return 1;
  }
}
