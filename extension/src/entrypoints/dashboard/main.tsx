import { render } from 'preact';
import { App } from '../../ui/dashboard/App';
import { consumeHandedSnapshot } from '../../ui/shared/saveFile';
import '../../ui/shared/styles.css';

void consumeHandedSnapshot();

render(<App />, document.getElementById('app')!);
