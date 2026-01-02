import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

client.connect()
  .then(() => {
    console.log('Connected to the database successfully!');
  })
  .catch(err => {
    console.error('Error connecting to the database:', err);
  })
  .finally(() => {
    client.end();
  });
