import { createRoot } from 'react-dom/client';
import ShipInternalControlPortal from './ShipInternalControlPortal';
import './styles.css';
import './itinerary/shipItinerary.css';
import './shipInternalControl.css';

createRoot(document.getElementById('root')!).render(<ShipInternalControlPortal />);
