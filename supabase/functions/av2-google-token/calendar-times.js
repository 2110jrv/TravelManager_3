import {ProviderError} from './lifecycle.js';
export async function updateCalendarTimes(calendarId,body,token,request=fetch){
 if(typeof calendarId!=='string'||!calendarId||!/^[-a-zA-Z0-9_]{1,1024}$/.test(body.event_id||'')||typeof body.etag!=='string'||!body.etag||typeof body.times!=='object'||!body.times||Object.keys(body.times).some(k=>!['start','end','completed'].includes(k)))throw new ProviderError('CALENDAR_TIME_INVALID',400);
 for(const k of ['start','end'])if(k in body.times&&(!/^\d{4}-\d{2}-\d{2}T/.test(body.times[k])||!Number.isFinite(Date.parse(body.times[k]))))throw new ProviderError('CALENDAR_TIME_INVALID',400);
 if('completed' in body.times&&typeof body.times.completed!=='boolean')throw new ProviderError('CALENDAR_TIME_INVALID',400);
 const url=`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(body.event_id)}`;
 const get=await request(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});if(!get.ok)throw new ProviderError('CALENDAR_EVENT_UNAVAILABLE',get.status===404?404:503);const original=await get.json();
 if(original.status==='cancelled'||original.etag!==body.etag)throw new ProviderError('CALENDAR_CHANGED_REFRESH_REQUIRED',409);
 const patch={};for(const k of ['start','end'])if(k in body.times)patch[k]={dateTime:body.times[k],...(original[k]?.timeZone?{timeZone:original[k].timeZone}:{})};
 if(original.start?.date&&('start' in patch||'end' in patch)&&!(patch.start&&patch.end))throw new ProviderError('CALENDAR_ALL_DAY_REQUIRES_BOTH_TIMES',400);
 const start=Date.parse(patch.start?.dateTime||original.start?.dateTime||original.start?.date),end=Date.parse(patch.end?.dateTime||original.end?.dateTime||original.end?.date);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new ProviderError('CALENDAR_END_MUST_FOLLOW_START',400);
 const privateFields={...original.extendedProperties?.private};if('completed' in body.times){privateFields.av2_completed=String(body.times.completed);patch.extendedProperties={...original.extendedProperties,private:privateFields};}
 const response=await request(url,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','If-Match':original.etag},body:JSON.stringify(patch),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new ProviderError(response.status===412?'CALENDAR_CHANGED_REFRESH_REQUIRED':response.status===403?'CALENDAR_WRITE_NOT_AUTHORIZED':'CALENDAR_WRITE_FAILED',response.status===412?409:response.status===403?403:503);return {event:await response.json()};
}
