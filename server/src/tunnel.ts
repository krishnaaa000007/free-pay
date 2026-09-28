import net from 'node:net';
import { readFileSync } from 'node:fs';
import { Client, type ConnectConfig } from 'ssh2';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Optional SSH tunnel: exposes a remote PostgreSQL on a local port so the API can talk
 * to a database that is only reachable from a bastion host. Purely additive; when
 * SSH_TUNNEL_ENABLED=false the API connects to Postgres directly.
 */
export interface Tunnel {
  host: string;
  port: number;
  close: () => Promise<void>;
}

export async function startTunnel(): Promise<Tunnel> {
  const { ssh } = config;
  if (!ssh.host || !ssh.user) {
    throw new Error('SSH_HOST and SSH_USER are required when SSH_TUNNEL_ENABLED=true');
  }
  const connectConfig: ConnectConfig = {
    host: ssh.host,
    port: ssh.port,
    username: ssh.user,
    readyTimeout: 20_000,
    keepaliveInterval: 15_000,
  };
  if (ssh.privateKeyPath) connectConfig.privateKey = readFileSync(ssh.privateKeyPath);
  else if (ssh.password) connectConfig.password = ssh.password;
  else throw new Error('Provide SSH_PRIVATE_KEY_PATH or SSH_PASSWORD for the tunnel');

  const client = new Client();
  await new Promise<void>((resolve, reject) => {
    client.once('ready', () => resolve());
    client.once('error', reject);
    client.connect(connectConfig);
  });
  logger.info('ssh tunnel connected', { host: ssh.host, remote: `${ssh.remoteDbHost}:${ssh.remoteDbPort}` });

  const server = net.createServer((socket) => {
    client.forwardOut(
      socket.remoteAddress ?? '127.0.0.1',
      socket.remotePort ?? 0,
      ssh.remoteDbHost,
      ssh.remoteDbPort,
      (err, stream) => {
        if (err) {
          logger.error('ssh forward failed', { error: err.message });
          socket.destroy();
          return;
        }
        socket.pipe(stream).pipe(socket);
        stream.on('close', () => socket.end());
        socket.on('close', () => stream.end());
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(ssh.localPort, '127.0.0.1', () => resolve());
  });
  logger.info('ssh tunnel listening', { localPort: ssh.localPort });

  return {
    host: '127.0.0.1',
    port: ssh.localPort,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      client.end();
    },
  };
}
