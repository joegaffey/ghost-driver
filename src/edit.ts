import './playback/play.css';
import { initPlaybackApp } from './playback/app';

const root = document.querySelector<HTMLDivElement>('#play-app');

if (!root) {
  throw new Error('Missing #play-app element');
}

initPlaybackApp(root, 'editor');
