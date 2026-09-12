import {createHmac} from 'node:crypto';
export type AggregatePayload={device_identifier:string;minute_start_utc:string;tvoc_mean:number;tvoc_min:number;tvoc_max:number;eco2_mean:number;eco2_min:number;eco2_max:number;aqi_max:number;sample_count:number};
export function validateAggregate(value:unknown,now=Date.now()):AggregatePayload{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected a JSON object.');
 const v=value as Record<string,unknown>;
 if(typeof v.device_identifier!=='string'||! /^[a-zA-Z0-9_-]{1,64}$/.test(v.device_identifier))throw new Error('Invalid device_identifier.');
 if(typeof v.minute_start_utc!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/.test(v.minute_start_utc))throw new Error('minute_start_utc must be a UTC minute, e.g. 2026-09-12T02:10:00Z.');
 const time=Date.parse(v.minute_start_utc);
 if(!Number.isFinite(time)||new Date(time).toISOString().replace('.000Z','Z')!==v.minute_start_utc||time<946684800000||time>now+60000)throw new Error('Invalid or future minute_start_utc.');
 for(const [field,min,max,integer] of [['tvoc_mean',0,65000,false],['tvoc_min',0,65000,true],['tvoc_max',0,65000,true],['eco2_mean',400,65000,false],['eco2_min',400,65000,true],['eco2_max',400,65000,true],['aqi_max',1,5,true],['sample_count',1,12,true]] as const){const n=v[field];if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n)))throw new Error(`Invalid ${field}.`);}
 const p=v as AggregatePayload;
 if(p.tvoc_min>p.tvoc_mean||p.tvoc_mean>p.tvoc_max||p.eco2_min>p.eco2_mean||p.eco2_mean>p.eco2_max)throw new Error('Means must lie between minimum and maximum.');
 return Object.fromEntries(['device_identifier','minute_start_utc','tvoc_mean','tvoc_min','tvoc_max','eco2_mean','eco2_min','eco2_max','aqi_max','sample_count'].map(k=>[k,v[k]])) as AggregatePayload;
}
export function hashDeviceKey(key:string,pepper:string){if(pepper.length<32)throw new Error('DEVICE_KEY_PEPPER must contain at least 32 characters.');return createHmac('sha256',pepper).update(key).digest('hex')}
export async function readBoundedJson(request:Request,limit=4096):Promise<unknown>{
 if(Number(request.headers.get('content-length')||0)>limit)throw new Error('Payload too large.');
 const reader=request.body?.getReader();if(!reader)throw new Error('Missing request body.');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error('Payload too large.');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Error('Invalid JSON.');}
}
