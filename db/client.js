var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { Pool } from "pg";
import { DATABASE_URL } from "./env.js";
export const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
});
export function query(text, params) {
    return __awaiter(this, void 0, void 0, function* () {
        const res = yield pool.query(text, params);
        return { rows: res.rows };
    });
}
