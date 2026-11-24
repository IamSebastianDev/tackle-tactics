import { mount } from '@grainular/nord';
import './ui/fonts.css';
import './ui/frames.css';
import './styles.css';
import { App } from './ui/App';
import { installDesktopKeys } from './ui/desktop';
import { fitStage } from './ui/stage';

const stage = document.querySelector<HTMLElement>('#app')!;
fitStage(stage);
mount(App, { to: stage });

installDesktopKeys();
