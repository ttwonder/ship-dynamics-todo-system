import { createRoot } from 'react-dom/client';
import ShipItineraryPortal from './itinerary/ShipItineraryPortal';
import './styles.css';
import './itinerary/shipItinerary.css';

createRoot(document.getElementById('root')!).render(<ShipItineraryPortal />);
