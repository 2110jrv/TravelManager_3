import {chronological} from './itinerary.js';import {occursOn} from './domain.js';
import {locationInput,validPoint} from './location.js';
export function gpsFor(event){
 const input=locationInput(event);if(input?.point)return input.point;const data=event.gps;
 return data&&data.input_key===input?.key&&validPoint(data.lat,data.lng)?{lat:data.lat,lng:data.lng}:null;
}
export function mapsPinUrl(event){const gps=gpsFor(event);return gps?`https://www.google.com/maps/search/?api=1&query=${gps.lat},${gps.lng}`:null;}
export function mapPlaces(events,day=null){return events.filter(e=>!e.deleted_at&&(!day||occursOn(e,day))).map(e=>{const point=gpsFor(e);return{...e,gps:point?{...e.gps,...point}:null};}).filter(e=>e.gps).sort(chronological);}
