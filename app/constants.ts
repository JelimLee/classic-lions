
import { Era, Instrument, UserProfile, Concert } from './types';

export const INITIAL_PROFILE: UserProfile = {
  preferredEras: [Era.ROMANTIC, Era.CLASSICAL],
  preferredInstruments: [Instrument.PIANO, Instrument.ORCHESTRA],
  favoriteArtists: ['조성진', '임윤찬'],
  favoriteComposers: ['Rachmaninoff', 'Beethoven', 'Chopin'],
  location: '서울',
  travelWillingness: false,
};

export const MOCK_PAST_CONCERTS: Concert[] = [
  {
    id: '1',
    title: '조성진 피아노 리사이틀',
    artist: '조성진',
    venue: '예술의전당 콘서트홀',
    date: '2024-05-15',
    program: ['Chopin - 24 Preludes, Op. 28'],
    imageUrl: 'https://picsum.photos/seed/pianist/400/600',
    type: 'past',
  }
];

export const MOCK_STATS = {
  popularArtist: '임윤찬',
  popularVenue: '예술의전당',
  trendingConcert: '조성진 & 바이에른 방송 교향악단',
  totalAttendedThisMonth: 1
};
