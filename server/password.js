import {randomBytes,scryptSync} from 'node:crypto';

export function hashPassword(password){
 const salt=randomBytes(16).toString('hex');
 return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;
}
