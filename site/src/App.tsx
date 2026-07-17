import Navbar from './components/Navbar';
import Hero from './components/Hero';
import Features from './components/Features';
import InstallTabs from './components/InstallTabs';
import Usage from './components/Usage';
import Footer from './components/Footer';

export default function App() {
  return (
    <>
      <Navbar />
      <Hero />
      <main>
        <Features />
        <InstallTabs />
        <Usage />
      </main>
      <Footer />
    </>
  );
}
