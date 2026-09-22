const TICKETS=Object.freeze({jennifer:'0162368493945',jonathan:'0162368493946'});
const SEATS=Object.freeze({UA2024:{jennifer:'38E',jonathan:'38F'},UA126:{jennifer:'50K',jonathan:'50L'},UA885:{jennifer:'49K',jonathan:'49L'},UA2025:{jennifer:'38B',jonathan:'38A'}});
export function flightPassengerMapping(flight){const seats=SEATS[String(flight||'').replaceAll(' ','').toUpperCase()];if(!seats)return null;return Object.fromEntries(Object.entries(TICKETS).map(([passengerId,ticket])=>[passengerId,{passengerId,sourcePassengerId:`PAX_${passengerId.toUpperCase()}`,ticketNumber:ticket,ticket,seat:seats[passengerId]}]));}
export function mapFlightPassengers(flight,passengers=[]){const mapping=flightPassengerMapping(flight);if(!mapping)return passengers;return passengers.map(p=>{const id=String(p.passengerId||p.sourcePassengerId||p.name||'').toLowerCase().replace('pax_','');const mapped=mapping[id];return mapped?{...p,...mapped}:{...p}})}
export const segmentTicketMapping={TICKETS,SEATS};
