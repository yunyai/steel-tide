import { installDeterministicMath } from './detMath';

// Imported first by the app (and the test setup) so no game code ever runs on the engine's own trig.
installDeterministicMath();
