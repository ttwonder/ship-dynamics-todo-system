import { createRoot } from 'react-dom/client';
import ShipTrackingPortal from './tracking/ShipTrackingPortal';
import './styles.css';
import './itinerary/shipItinerary.css';
import './shipInternalControl.css';
import './tracking/shipTracking.css';

createRoot(document.getElementById('root')!).render(<ShipTrackingPortal />);
