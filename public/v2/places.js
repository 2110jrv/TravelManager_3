import {chronological} from './itinerary.js';import {occursOn} from './domain.js';
const valid=(lat,lng)=>Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;
export function gpsFor(event){
 const data=event.gps||event.coordinates||event.extendedProperties?.private||{};
 if(data.lat!=null&&data.lng!=null&&valid(Number(data.lat),Number(data.lng)))return{lat:Number(data.lat),lng:Number(data.lng)};
 const text=`${event.location||''} ${event.description||''}`.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&');
 const decimal='([-+]?\\d{1,3}\\.\\d{4,})';
 const patterns=[new RegExp('\\bGPS\\s*[:=]\\s*'+decimal+'\\s*[,;]\\s*'+decimal,'i'),new RegExp('\\b(?:LAT|LATITUDE)\\s*=\\s*'+decimal+'\\s+(?:LNG|LON|LONGITUDE)\\s*=\\s*'+decimal,'i'),new RegExp('(?:[?&](?:query|q)=|geo:)'+decimal+'(?:,|%2C)'+decimal,'i'),new RegExp('!3d'+decimal+'!4d'+decimal,'i')];
 for(const pattern of patterns){const match=pattern.exec(text);if(match&&valid(Number(match[1]),Number(match[2])))return{lat:Number(match[1]),lng:Number(match[2])};}
 return null;
}
export function mapsPinUrl(event){const gps=gpsFor(event);return gps?`https://www.google.com/maps/search/?api=1&query=${gps.lat},${gps.lng}`:null;}
export function mapPlaces(events,day=null){return events.filter(e=>!e.deleted_at&&(!day||occursOn(e,day))).map(e=>({...e,gps:gpsFor(e)})).filter(e=>e.gps).sort(chronological);}
