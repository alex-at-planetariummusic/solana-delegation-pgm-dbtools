import { Client } from 'pg';

// The pg library uses the environment variables listed here: https://www.postgresql.org/docs/9.1/libpq-envars.html
// So to connect, add these variables to your environment or add them to a .env file
import {config} from 'dotenv';
config();

export default new Client({
  ssl: {
    rejectUnauthorized: false
  }
});
